/**
 * POST /api/v1/migration/runs/:id/homologate — marca a execução como
 * HOMOLOGADA (irreversível: rollback bloqueado para sempre). Exige o estágio
 * report concluído. Auditoria migration.homologated. RBAC: migration.manage.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { toMigrationRunView, issueCountsByRun, mappingCountsByRun } from '@/lib/server/migration/stages'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    confirmation: z.literal('HOMOLOGAR', { message: 'Digite HOMOLOGAR para confirmar.' }),
    note: z.string().max(2000).optional().nullable(),
  })
  .strict()

export const POST = apiHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'migration.manage')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json().catch(() => ({})))

  const run = await db.migrationRun.findUnique({ where: { id } })
  if (!run) throw notFound(`Execução de migração "${id}" não encontrada.`)
  assertTenantScope(actor, run.tenantId)

  if (run.homologated) {
    throw new DomainError('MIGRATION_HOMOLOGATED', 409, 'Execução homologada', 'Esta execução já foi homologada — a ação é irreversível.')
  }

  let stats: Record<string, unknown> = {}
  try {
    stats = JSON.parse(run.stats)
  } catch {
    stats = {}
  }
  if (!('report' in stats)) {
    throw new DomainError(
      'MIGRATION_INVALID_STAGE',
      409,
      'Relatório pendente',
      'Gere o relatório final (estágio report) antes de homologar a execução.'
    )
  }

  const updated = await withTransaction(async (tx) => {
    const next = await tx.migrationRun.update({
      where: { id },
      data: { homologated: true },
    })
    await writeAudit(tx, {
      tenantId: run.tenantId,
      actor,
      action: 'migration.homologated',
      aggregateType: 'migration',
      aggregateId: run.id,
      summary: `Migração HOMOLOGADA (irreversível): dados importados do legado tornam-se oficiais e o rollback fica definitivamente bloqueado.`,
      after: { homologated: true },
      justification: body.note ?? 'Homologação da migração do PainelDeskLegis 8.1.',
      correlationId,
    })
    return next
  })

  const [issueCounts, mappingCounts] = await Promise.all([issueCountsByRun([id]), mappingCountsByRun([id])])
  return Response.json({
    run: toMigrationRunView(updated, {
      issueCounts: issueCounts.get(id) ?? { info: 0, warn: 0, error: 0 },
      mappingCount: mappingCounts.get(id) ?? 0,
    }),
  })
})
