/**
 * POST/GET /api/v1/platform/tenants/:id/export — exportação integral do tenant
 * como JOB ASSÍNCRONO (Fase 20 / ADR-021). RBAC `platform.manage`.
 *
 * - POST: cria `ExportJob` (pending) e responde **202 { job }** imediatamente;
 *   o processamento roda em background (`void processExportJob()` — sem await)
 *   em etapas REAIS de contagem por grupo de tabelas com progresso monotônico
 *   0→100 (atualizando o job a cada etapa) + serialização integral de
 *   validação via `buildTenantExport`. Falha → status=failed + error.
 *   Concorrência: um job por tenant (pending/running → 409). Auditoria
 *   `platform.export_job_created` na criação; `platform.tenant_exported`
 *   permanece no DOWNLOAD (quando os dados realmente saem).
 * - GET: devolve `{ job }` do ÚLTIMO job do tenant (null quando nunca houve) —
 *   usado pelo Console para retomar o progresso/listar jobs concluídos.
 *
 * O shape do JSON exportado é IDÊNTICO ao export síncrono da Fase 16 (sem
 * segredos) — ver src/lib/server/tenant-export.ts.
 */
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { buildTenantExport, toExportJobView } from '@/lib/server/tenant-export'

export const dynamic = 'force-dynamic'

// ─── Processamento assíncrono (etapas reais, progresso monotônico) ──────────

const STAGE_PACING_MS = 200 // ritmo de "chunk" — progresso visível no Console

type Stage = {
  label: string
  to: number
  steps: Array<{ label: string; run: () => Promise<number> }>
}

function exportStages(tenantId: string): Stage[] {
  return [
    {
      label: 'Estrutura',
      to: 10,
      steps: [
        { label: 'legislaturas', run: () => db.legislature.count({ where: { tenantId } }) },
        { label: 'parlamentares', run: () => db.parliamentarian.count({ where: { tenantId } }) },
        { label: 'partidos/blocos', run: () => db.party.count({ where: { tenantId } }) },
        { label: 'mesa/mandatos/licenças', run: () => db.mandate.count({ where: { tenantId } }) },
      ],
    },
    {
      label: 'Comissões',
      to: 20,
      steps: [
        { label: 'comissões', run: () => db.committee.count({ where: { tenantId } }) },
        { label: 'membros', run: () => db.committeeMember.count({ where: { committee: { tenantId } } }) },
        { label: 'reuniões', run: () => db.committeeMeeting.count({ where: { committee: { tenantId } } }) },
      ],
    },
    {
      label: 'Matérias',
      to: 40,
      steps: [
        { label: 'matérias', run: () => db.legislativeMatter.count({ where: { tenantId } }) },
        { label: 'proceedings', run: () => db.proceeding.count({ where: { matter: { tenantId } } }) },
        { label: 'protocolo', run: () => db.protocolEntry.count({ where: { tenantId } }) },
        { label: 'tarefas', run: () => db.legislativeTask.count({ where: { tenantId } }) },
      ],
    },
    {
      label: 'Sessões e votações',
      to: 55,
      steps: [
        { label: 'sessões', run: () => db.session.count({ where: { tenantId } }) },
        { label: 'votações', run: () => db.voting.count({ where: { session: { tenantId } } }) },
        { label: 'votos', run: () => db.vote.count({ where: { voting: { session: { tenantId } } } }) },
        { label: 'discursos', run: () => db.speech.count({ where: { session: { tenantId } } }) },
      ],
    },
    {
      label: 'Publicações e audiências',
      to: 65,
      steps: [
        { label: 'publicações', run: () => db.publication.count({ where: { tenantId } }) },
        { label: 'audiências', run: () => db.publicHearing.count({ where: { tenantId } }) },
      ],
    },
    {
      label: 'Modelos e integrações',
      to: 75,
      steps: [
        { label: 'modelos', run: () => db.documentTemplate.count({ where: { tenantId } }) },
        { label: 'notificações', run: () => db.notification.count({ where: { tenantId } }) },
        { label: 'webhooks', run: () => db.webhookEndpoint.count({ where: { tenantId } }) },
      ],
    },
    {
      label: 'Faturamento e usuários',
      to: 85,
      steps: [
        { label: 'faturas', run: () => db.invoice.count({ where: { tenantId } }) },
        { label: 'usuários', run: () => db.user.count({ where: { tenantId } }) },
      ],
    },
    {
      label: 'Auditoria',
      to: 92,
      steps: [
        { label: 'eventos', run: () => db.auditEvent.count({ where: { tenantId } }) },
      ],
    },
  ]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Processa o job em background (fire-and-forget): contagens reais por grupo de
 * tabelas (progresso monotônico por etapa) e serialização integral final de
 * validação (mesmo builder do download). Qualquer falha → status=failed +
 * error (truncado) — o job NUNCA fica preso em running.
 */
async function processExportJob(jobId: string, tenantId: string): Promise<void> {
  try {
    await db.exportJob.update({
      where: { id: jobId },
      data: { status: 'running', progress: 1 },
    })
    for (const stage of exportStages(tenantId)) {
      const counts = await Promise.all(stage.steps.map((s) => s.run()))
      const detail = stage.steps
        .map((s, i) => `${s.label}: ${counts[i]}`)
        .join(', ')
      console.log(`[export-job ${jobId.slice(-6)}] ${stage.label} (${stage.to}%) — ${detail}`)
      await db.exportJob.update({ where: { id: jobId }, data: { progress: stage.to } })
      await sleep(STAGE_PACING_MS)
    }
    // Serialização integral de validação (mesmo builder usado no download).
    const payload = await buildTenantExport(tenantId)
    console.log(
      `[export-job ${jobId.slice(-6)}] serialização concluída — ${Object.keys(payload.data).length} grupos, ${payload.counts.legislativeMatters} matérias`
    )
    await db.exportJob.update({
      where: { id: jobId },
      data: { status: 'done', progress: 100, finishedAt: new Date(), error: null },
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    console.error(`[export-job ${jobId.slice(-6)}] falhou:`, raw)
    await db.exportJob
      .update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: raw.slice(0, 300),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined)
  }
}

// ─── Rotas ──────────────────────────────────────────────────────────────────

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params

    const tenant = await db.tenant.findUnique({ where: { id } })
    if (!tenant) throw notFound('Tenant não encontrado.')

    // Concorrência: um job por tenant por vez (guarda em transação serializada
    // in-process — dois POSTs simultâneos não criam dois jobs).
    const job = await withTransaction(async (tx) => {
      const running = await tx.exportJob.findFirst({
        where: { tenantId: id, status: { in: ['pending', 'running'] } },
        select: { id: true, status: true, progress: true },
      })
      if (running) {
        throw new DomainError(
          'CONFLICT_VERSION',
          409,
          'Exportação em andamento',
          `Já existe uma exportação em andamento para "${tenant.name}" (${running.status}, ${running.progress}%). Aguarde a conclusão para baixar ou iniciar outra.`
        )
      }
      const created = await tx.exportJob.create({
        data: { tenantId: id, status: 'pending', progress: 0 },
      })
      await writeAudit(tx, {
        tenantId: id,
        actor,
        action: 'platform.export_job_created',
        aggregateType: 'export_job',
        aggregateId: created.id,
        summary: `Job de exportação integral criado para "${tenant.name}" (processamento assíncrono com progresso).`,
        before: null,
        after: { jobId: created.id, status: 'pending', progress: 0 },
        justification: 'Exportação assíncrona solicitada pelo console da plataforma (platform_owner).',
        correlationId,
      })
      return created
    })

    // Fire-and-forget: a resposta NÃO espera o processamento (202 Accepted).
    void processExportJob(job.id, id)

    return Response.json({ job: toExportJobView(job) }, { status: 202 })
  }
)

export const GET = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, _correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params

    const tenant = await db.tenant.findUnique({ where: { id }, select: { id: true } })
    if (!tenant) throw notFound('Tenant não encontrado.')

    const job = await db.exportJob.findFirst({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' },
    })
    return Response.json({ job: job ? toExportJobView(job) : null })
  }
)
