/**
 * GET|POST /api/v1/matter-types — tipos de matéria configuráveis por tenant.
 * POST: RBAC structure.write; código único por tenant.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toMatterTypeConfigView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const configs = await db.matterTypeConfig.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  })
  return Response.json({ matterTypes: configs.map(toMatterTypeConfigView) })
})

const createSchema = z.object({
  code: z
    .string()
    .min(3, 'Código obrigatório.')
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Código em snake_case (a-z, 0-9, _).'),
  name: z.string().min(3, 'Nome obrigatório.').max(80),
  defaultRegime: z.enum(['ordinario', 'urgencia']).optional(),
  active: z.boolean().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const config = await withTransaction(async (tx) => {
    const dup = await tx.matterTypeConfig.findUnique({ where: { tenantId_code: { tenantId, code: body.code } } })
    if (dup) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Dados inválidos', `Tipo de matéria "${body.code}" já configurado neste tenant.`)
    }
    const created = await tx.matterTypeConfig.create({
      data: {
        tenantId,
        code: body.code,
        name: body.name.trim(),
        defaultRegime: body.defaultRegime ?? 'ordinario',
        active: body.active ?? true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'matter_type.create',
      aggregateType: 'matter_type_config',
      aggregateId: created.id,
      summary: `Tipo de matéria configurado: ${created.name} (${created.code}).`,
      after: { code: created.code, name: created.name, defaultRegime: created.defaultRegime },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId,
      eventType: 'structure.changed',
      aggregateId: created.id,
      aggregateVersion: 1,
      correlationId,
      origin: 'operator',
      internalPayload: { entity: 'matter_type_config', event: 'created', id: created.id, code: created.code },
    })
    return created
  })

  return Response.json({ matterType: toMatterTypeConfigView(config) }, { status: 201 })
})
