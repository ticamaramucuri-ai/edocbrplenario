/**
 * POST /api/v1/migration/run {stage, runId?, justification?} — executa um
 * estágio do pipeline auditável (inspect cria a execução; demais estágios
 * exigem runId). Import SEMPRE no tenant do ator (nunca de outro tenant).
 * RBAC: migration.manage (tenant_admin, legislative_admin, platform_owner).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { executeStage, MIGRATION_STAGES, toMigrationRunView, issueCountsByRun, mappingCountsByRun, type MigrationStage } from '@/lib/server/migration/stages'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const bodySchema = z.object({
  stage: z.enum(MIGRATION_STAGES as [MigrationStage, ...MigrationStage[]]),
  runId: z.string().min(1).optional().nullable(),
  justification: z.string().max(2000).optional().nullable(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'migration.manage')
  const tenantId = await resolveTenantScope(req, actor)
  const body = bodySchema.parse(await req.json())

  const run = await executeStage({
    actor,
    tenantId,
    stage: body.stage,
    runId: body.runId ?? null,
    justification: body.justification ?? null,
    correlationId,
  })

  const [issueCounts, mappingCounts] = await Promise.all([issueCountsByRun([run.id]), mappingCountsByRun([run.id])])
  return Response.json({
    run: toMigrationRunView(run, {
      issueCounts: issueCounts.get(run.id) ?? { info: 0, warn: 0, error: 0 },
      mappingCount: mappingCounts.get(run.id) ?? 0,
    }),
  })
})
