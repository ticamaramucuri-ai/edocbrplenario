/**
 * GET /api/v1/migration/runs — execuções de migração do tenant do ator com
 * estágio, status, resumo de stats e contagens de issues.
 * RBAC: migration.manage.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toMigrationRunView, issueCountsByRun, mappingCountsByRun } from '@/lib/server/migration/stages'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'migration.manage')
  const tenantId = await resolveTenantScope(req, actor)

  const runs = await db.migrationRun.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const ids = runs.map((r) => r.id)
  const [issueCounts, mappingCounts] = await Promise.all([issueCountsByRun(ids), mappingCountsByRun(ids)])

  return Response.json({
    runs: runs.map((run) =>
      toMigrationRunView(run, {
        issueCounts: issueCounts.get(run.id) ?? { info: 0, warn: 0, error: 0 },
        mappingCount: mappingCounts.get(run.id) ?? 0,
      })
    ),
  })
})
