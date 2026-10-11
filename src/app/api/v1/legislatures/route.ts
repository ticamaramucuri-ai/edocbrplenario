/**
 * GET|POST /api/v1/legislatures — legislaturas do tenant.
 * GET: ordenadas por startYear desc. POST: RBAC structure.write.
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
import { toLegislatureView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const legislatures = await db.legislature.findMany({
    where: { tenantId },
    orderBy: [{ startYear: 'desc' }, { number: 'desc' }],
  })
  return Response.json({ legislatures: legislatures.map(toLegislatureView) })
})

const createSchema = z.object({
  number: z.number().int().min(1).max(999),
  startYear: z.number().int().min(1990).max(2100),
  endYear: z.number().int().min(1990).max(2100),
  current: z.boolean().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())
  if (body.endYear < body.startYear) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Ano final da legislatura não pode ser anterior ao ano inicial.',
      { errors: { endYear: ['Ano final anterior ao inicial.'] } }
    )
  }

  const legislature = await withTransaction(async (tx) => {
    const dup = await tx.legislature.findFirst({
      where: { tenantId, number: body.number },
      select: { id: true },
    })
    if (dup) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        `Legislatura nº ${body.number} já existe neste tenant.`
      )
    }
    const created = await tx.legislature.create({
      data: {
        tenantId,
        number: body.number,
        startYear: body.startYear,
        endYear: body.endYear,
        current: false,
      },
    })
    // Marcar como atual desmarca as demais do tenant.
    if (body.current) {
      await tx.legislature.updateMany({ where: { tenantId, id: { not: created.id } }, data: { current: false } })
      await tx.legislature.update({ where: { id: created.id }, data: { current: true } })
    }
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'legislature.created',
      aggregateType: 'legislature',
      aggregateId: created.id,
      summary: `Legislatura nº ${created.number} (${created.startYear}–${created.endYear}) criada.`,
      after: { number: created.number, startYear: created.startYear, endYear: created.endYear },
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
      internalPayload: { entity: 'legislature', event: 'created', id: created.id, number: created.number },
    })
    return tx.legislature.findUnique({ where: { id: created.id } })
  })

  return Response.json({ legislature: toLegislatureView(legislature!) }, { status: 201 })
})
