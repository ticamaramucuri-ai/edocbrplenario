/**
 * GET /api/v1/webhooks/:id/deliveries?status=&limit= — entregas do endpoint
 * (attempts, lastError, responseStatus). GET liberado aos atores do tenant.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import type { WebhookDeliveryView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const STATUSES = ['pending', 'success', 'failed', 'dead']

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id } })
  if (!endpoint) throw notFound('Webhook não encontrado.')
  assertTenantScope(actor, endpoint.tenantId)

  const params = req.nextUrl.searchParams
  const status = params.get('status')?.trim() || null
  const limit = Math.min(Math.max(parseInt(params.get('limit')?.trim() || '50', 10) || 50, 1), 200)
  if (status && !STATUSES.includes(status)) {
    throw notFound(`Status de entrega inválido ("${status}"). Use: ${STATUSES.join(', ')}.`)
  }

  const [deliveries, counts] = await Promise.all([
    db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.webhookDelivery.groupBy({
      by: ['status'],
      where: { endpointId: endpoint.id },
      _count: { _all: true },
    }),
  ])

  const countsMap: Record<string, number> = { pending: 0, success: 0, failed: 0, dead: 0 }
  for (const g of counts) countsMap[g.status] = g._count._all

  const views: WebhookDeliveryView[] = deliveries.map((d) => ({
    id: d.id,
    endpointId: d.endpointId,
    eventType: d.eventType,
    status: d.status as WebhookDeliveryView['status'],
    attempts: d.attempts,
    lastError: d.lastError ?? null,
    responseStatus: d.responseStatus ?? null,
    nextAttemptAt: d.nextAttemptAt ? d.nextAttemptAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
  }))

  return Response.json({ deliveries: views, counts: countsMap })
})
