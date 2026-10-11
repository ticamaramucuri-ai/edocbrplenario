/**
 * POST /api/v1/platform/exports/:id/requeue — reprocessa um job de exportação
 * com falha (Onda 5 / Fase 21, card "Watchdog de exportações" do Suporte).
 * RBAC `platform.read` (platform_owner E platform_support — o suporte opera o
 * watchdog; decisões de reprocessamento ficam registradas na auditoria do
 * tenant do job).
 *
 * Fluxo:
 *  1. job em `failed` (senão 422) → `status='pending', progress=0,
 *     finishedAt=null, error=null`;
 *  2. reconhece (ack) o alerta persistente `export.orphan` relacionado ao job
 *     (kind + meta.jobId), se houver um aberto — o alerta cumpriu seu papel;
 *  3. audita `platform.export_requeued` na cadeia do tenant;
 *  4. dispara o REPROCESSAMENTO real em background (fire-and-forget, mesmo
 *     padrão do POST /platform/tenants/:id/export): etapas reais de contagem
 *     com progresso monotônico + serialização integral de validação via
 *     buildTenantExport. Falha → status=failed de novo (o watchdog recolhe).
 *
 * O caminho de produção com worker dedicado e posse exclusiva da fila está
 * registrado no ADR-022; no sandbox o processamento roda no próprio processo
 * da API, idêntico ao fluxo original de criação do job.
 */
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { buildTenantExport, toExportJobView } from '@/lib/server/tenant-export'

export const dynamic = 'force-dynamic'

// ─── Reprocessamento assíncrono (etapas reais, progresso monotônico) ─────────

const STAGE_PACING_MS = 200

type CountStep = [string, () => Promise<number>]

/** Mesmas famílias de dados do POST /platform/tenants/:id/export (compacto). */
function reprocessStages(tenantId: string): Array<{ to: number; steps: CountStep[] }> {
  return [
    {
      to: 10,
      steps: [
        ['legislaturas', () => db.legislature.count({ where: { tenantId } })],
        ['parlamentares', () => db.parliamentarian.count({ where: { tenantId } })],
      ],
    },
    {
      to: 25,
      steps: [
        ['matérias', () => db.legislativeMatter.count({ where: { tenantId } })],
        ['proceedings', () => db.proceeding.count({ where: { matter: { tenantId } } })],
      ],
    },
    {
      to: 50,
      steps: [
        ['sessões', () => db.session.count({ where: { tenantId } })],
        ['votações', () => db.voting.count({ where: { session: { tenantId } } })],
        ['votos', () => db.vote.count({ where: { voting: { session: { tenantId } } } })],
      ],
    },
    {
      to: 70,
      steps: [
        ['publicações', () => db.publication.count({ where: { tenantId } })],
        ['audiências', () => db.publicHearing.count({ where: { tenantId } })],
      ],
    },
    {
      to: 85,
      steps: [
        ['usuários', () => db.user.count({ where: { tenantId } })],
        ['faturas', () => db.invoice.count({ where: { tenantId } })],
      ],
    },
    {
      to: 92,
      steps: [['eventos de auditoria', () => db.auditEvent.count({ where: { tenantId } })]],
    },
  ]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reprocessa o job em background: contagens reais + serialização final. */
async function reprocessExportJob(jobId: string, tenantId: string): Promise<void> {
  try {
    await db.exportJob.update({ where: { id: jobId }, data: { status: 'running', progress: 1 } })
    for (const stage of reprocessStages(tenantId)) {
      const counts = await Promise.all(stage.steps.map(([, run]) => run()))
      const detail = stage.steps.map(([label], i) => `${label}: ${counts[i]}`).join(', ')
      console.log(`[export-requeue ${jobId.slice(-6)}] ${stage.to}% — ${detail}`)
      await db.exportJob.update({ where: { id: jobId }, data: { progress: stage.to } })
      await sleep(STAGE_PACING_MS)
    }
    const payload = await buildTenantExport(tenantId)
    console.log(
      `[export-requeue ${jobId.slice(-6)}] serialização concluída — ${Object.keys(payload.data).length} grupos`
    )
    await db.exportJob.update({
      where: { id: jobId },
      data: { status: 'done', progress: 100, finishedAt: new Date(), error: null },
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    console.error(`[export-requeue ${jobId.slice(-6)}] falhou:`, raw)
    await db.exportJob
      .update({
        where: { id: jobId },
        data: { status: 'failed', error: raw.slice(0, 300), finishedAt: new Date() },
      })
      .catch(() => undefined)
  }
}

// ─── Rota ───────────────────────────────────────────────────────────────────

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.read')

    const { id } = await ctx.params
    const job = await db.exportJob.findUnique({ where: { id }, include: { tenant: true } })
    if (!job) throw notFound('Job de exportação não encontrado.')

    if (job.status !== 'failed') {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Reprocessamento indisponível',
        `Apenas jobs de exportação com falha podem ser reprocessados (status atual: "${job.status}").`,
        { errors: { status: ['Job precisa estar em "failed" para reprocessar.'] } }
      )
    }

    // 1) Reconhece o alerta export.orphan relacionado (se aberto) na mesma
    //    transação do reset do job — o alerta cumpriu seu papel operacional.
    const now = new Date()
    await withTransaction(async (tx) => {
      const openOrphans = await tx.platformAlert.findMany({
        where: { kind: 'export.orphan', ackAt: null },
      })
      const related = openOrphans.filter((a) => {
        try {
          return (JSON.parse(a.meta) as { jobId?: string })?.jobId === job.id
        } catch {
          return false
        }
      })

      const reset = await tx.exportJob.update({
        where: { id: job.id },
        data: { status: 'pending', progress: 0, finishedAt: null, error: null },
      })

      if (related.length > 0) {
        await tx.platformAlert.updateMany({
          where: { id: { in: related.map((a) => a.id) }, ackAt: null },
          data: { ackAt: now, ackBy: actor.name },
        })
      }

      await writeAudit(tx, {
        tenantId: job.tenantId,
        actor,
        action: 'platform.export_requeued',
        aggregateType: 'export_job',
        aggregateId: job.id,
        summary: `Job de exportação ${job.id.slice(-6)} reprocessado pelo suporte (${actor.name})${related.length > 0 ? ` — ${related.length} alerta(s) export.orphan reconhecido(s)` : ''}.`,
        before: { status: 'failed', error: job.error },
        after: { status: 'pending', progress: 0, finishedAt: null },
        justification: 'Reprocessamento solicitado no Watchdog de exportações (Suporte da Plataforma).',
        correlationId,
      })
      return reset
    })

    // 2) Fire-and-forget: reprocessa em background (responde 202 Accepted).
    void reprocessExportJob(job.id, job.tenantId)

    const fresh = await db.exportJob.findUnique({ where: { id: job.id } })
    return Response.json({ job: fresh ? toExportJobView(fresh) : null }, { status: 202 })
  }
)
