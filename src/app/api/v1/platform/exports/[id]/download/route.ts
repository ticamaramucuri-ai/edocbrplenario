/**
 * GET /api/v1/platform/exports/:id/download — download do JSON integral do
 * tenant (Fase 20). RBAC `platform.manage`. Somente quando o job está `done`
 * (senão 409 com o estado atual). O payload é REGENERADO de forma
 * determinística via `buildTenantExport` no momento do download — snapshot
 * consistente com o estado corrente do tenant (documentado também no header
 * `X-Export-Snapshot` da resposta). Auditoria `platform.tenant_exported`
 * acontece AQUI (quando os dados realmente saem — mesma ação do export
 * síncrono da Fase 16), gravada APÓS montar o payload.
 */
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { buildTenantExport } from '@/lib/server/tenant-export'
import { EXPORT_JOB_STATUS_LABEL } from '@/lib/contracts'
import type { ExportJobStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')

    const { id } = await ctx.params
    const job = await db.exportJob.findUnique({ where: { id } })
    if (!job) throw notFound('Job de exportação não encontrado.')

    if (job.status !== 'done') {
      throw new DomainError(
        'CONFLICT_VERSION',
        409,
        'Exportação não concluída',
        `O job está ${EXPORT_JOB_STATUS_LABEL[job.status as ExportJobStatus] ?? job.status} (${job.progress}%). Aguarde a conclusão para baixar o arquivo.`
      )
    }

    const tenant = await db.tenant.findUnique({ where: { id: job.tenantId } })
    if (!tenant) throw notFound('Tenant do job não encontrado.')

    // Regeneração determinística — snapshot consistente no momento do download.
    const payload = await buildTenantExport(job.tenantId)
    const counts = payload.counts

    // Auditoria APÓS montar o payload (o evento não faz parte do arquivo).
    await withTransaction((tx) =>
      writeAudit(tx, {
        tenantId: job.tenantId,
        actor,
        action: 'platform.tenant_exported',
        aggregateType: 'tenant',
        aggregateId: job.tenantId,
        summary:
          `Download da exportação integral do tenant "${tenant.name}": ${counts.users} usuários, ` +
          `${counts.parliamentarians} parlamentares, ${counts.legislativeMatters} matérias, ` +
          `${counts.sessions} sessões, ${counts.publications} publicações e ` +
          `${counts.auditEvents} eventos de auditoria (votos secretos sem valor).`,
        justification: 'Download do job de exportação assíncrono pelo console da plataforma (platform_owner).',
        correlationId,
      })
    )

    return Response.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="export-${tenant.slug}-${job.id}.json"`,
        // Snapshot consistente: o arquivo reflete o estado do tenant no MOMENTO
        // do download (regenerado deterministicamente — não é um artefato
        // congelado no fim do job).
        'X-Export-Snapshot': 'consistent-at-download-time',
      },
    })
  }
)
