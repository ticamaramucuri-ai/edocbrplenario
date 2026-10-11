/**
 * GET /api/v1/platform/exports/:id — status/progresso de um job de exportação
 * (Fase 20). RBAC `platform.manage`. Devolve `{ job: ExportJobView }` com
 * progresso 0–100 (polling de 1s no Console enquanto pending/running).
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toExportJobView } from '@/lib/server/tenant-export'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, _correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')

    const { id } = await ctx.params
    const job = await db.exportJob.findUnique({ where: { id } })
    if (!job) throw notFound('Job de exportação não encontrado.')

    return Response.json({ job: toExportJobView(job) })
  }
)
