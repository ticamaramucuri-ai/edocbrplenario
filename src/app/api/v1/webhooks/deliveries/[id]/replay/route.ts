/**
 * POST /api/v1/webhooks/deliveries/:id/replay — recria entrega `pending` com o
 * MESMO payload (nova linha; a original permanece para auditoria). Auditoria
 * `webhook.replayed`.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'webhook.manage')
  const { id } = await ctx.params
  const delivery = await db.webhookDelivery.findUnique({
    where: { id },
    include: { endpoint: true },
  })
  if (!delivery) throw notFound('Entrega não encontrada.')
  assertTenantScope(actor, delivery.endpoint.tenantId)

  const replayed = await withTransaction(async (tx) => {
    const created = await tx.webhookDelivery.create({
      data: {
        endpointId: delivery.endpointId,
        eventType: delivery.eventType,
        payload: delivery.payload,
        status: 'pending',
      },
    })
    await writeAudit(tx, {
      tenantId: delivery.endpoint.tenantId,
      actor,
      action: 'webhook.replayed',
      aggregateType: 'webhook',
      aggregateId: delivery.endpointId,
      summary: `Entrega ${delivery.eventType} reprocessada (original ${delivery.id.slice(0, 8)} → nova ${created.id.slice(0, 8)}).`,
      before: { deliveryId: delivery.id, status: delivery.status },
      after: { deliveryId: created.id, status: 'pending' },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json(
    {
      delivery: {
        id: replayed.id,
        endpointId: replayed.endpointId,
        eventType: replayed.eventType,
        status: replayed.status,
        attempts: replayed.attempts,
        createdAt: replayed.createdAt.toISOString(),
      },
    },
    { status: 201 }
  )
})
