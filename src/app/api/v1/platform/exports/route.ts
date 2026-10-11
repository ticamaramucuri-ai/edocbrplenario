/**
 * GET /api/v1/platform/exports — lista os jobs de exportação que interessam ao
 * Watchdog de exportações (Onda 5 / Fase 21): jobs em `failed` ou `running`
 * (mais recentes primeiro, máx. 50), com o tenant para exibição no módulo
 * Suporte da Plataforma. RBAC `platform.read` (platform_owner e
 * platform_support — o suporte opera o watchdog).
 *
 * Jobs em `running` são exibidos com o tempo decorrido para o operador
 * acompanhar quando o watchdog (:3005, kind export.watchdog) deve intervenir
 * (> 10 min → failed + alerta export.orphan).
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toExportJobView } from '@/lib/server/tenant-export'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  const rows = await db.exportJob.findMany({
    where: { status: { in: ['failed', 'running'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { tenant: { select: { name: true, slug: true } } },
  })

  return Response.json({
    jobs: rows.map((job) => ({
      ...toExportJobView(job),
      tenant: { name: job.tenant.name, slug: job.tenant.slug },
    })),
  })
})
