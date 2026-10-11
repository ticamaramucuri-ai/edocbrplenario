/**
 * GET /api/v1/migration/runs/:id — execução completa + issues (máx. 500) +
 * contagens de mappings. RBAC: migration.manage (escopo do tenant do ator).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toMigrationRunView, issueCountsByRun, mappingCountsByRun } from '@/lib/server/migration/stages'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'migration.manage')
  const { id } = await ctx.params

  const [run, issues, mappingCount, issueCounts] = await Promise.all([
    db.migrationRun.findUnique({ where: { id } }),
    db.migrationIssue.findMany({ where: { runId: id }, orderBy: [{ severity: 'asc' }, { id: 'asc' }], take: 500 }),
    db.migrationMapping.count({ where: { runId: id } }),
    issueCountsByRun([id]),
  ])
  if (!run) throw notFound(`Execução de migração "${id}" não encontrada.`)
  assertTenantScope(actor, run.tenantId)

  return Response.json({
    run: toMigrationRunView(run, {
      issueCounts: issueCounts.get(run.id) ?? { info: 0, warn: 0, error: 0 },
      mappingCount,
      issues: issues.map((i) => ({
        id: i.id,
        severity: i.severity,
        sourceRef: i.sourceRef,
        message: i.message,
      })),
    }),
  })
})
