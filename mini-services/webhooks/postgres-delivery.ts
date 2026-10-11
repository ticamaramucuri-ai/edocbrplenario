import type { PrismaClient, WebhookDelivery, WebhookEndpoint } from '@prisma/client'

export type DeliveryOutcome =
  | { kind: 'success'; responseStatus: number }
  | { kind: 'failure'; responseStatus: number | null; error: string }

export type DeliverySender = (
  endpoint: WebhookEndpoint,
  delivery: WebhookDelivery,
) => Promise<DeliveryOutcome>

const MAX_ATTEMPTS = 5
const BACKOFF_SECONDS = [5, 30, 120, 600]

/** Conditional leases prevent parallel sends; crash recovery remains at least once. */
export async function processPostgresWebhookBatch(
  db: PrismaClient,
  send: DeliverySender,
  now = new Date(),
  limit = 10,
): Promise<number> {
  const owner = crypto.randomUUID()
  const rows = await db.webhookDelivery.findMany({
    where: {
      status: 'pending',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }],
    },
    include: { endpoint: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })

  let processed = 0
  for (const row of rows) {
    const claim = await db.webhookDelivery.updateMany({
      where: { id: row.id, status: 'pending', AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
      ] },
      data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 60_000) },
    })
    if (!claim.count) continue
    processed++
    const endpoint = row.endpoint
    if (!endpoint.active) {
      await db.webhookDelivery.updateMany({
        where: { id: row.id, status: 'pending', leaseOwner: owner },
        data: { nextAttemptAt: new Date(now.getTime() + 60_000), leaseOwner: null, leaseUntil: null },
      })
      continue
    }

    let outcome: DeliveryOutcome
    try {
      outcome = await send(endpoint, row)
    } catch (error) {
      outcome = { kind: 'failure', responseStatus: null, error: String(error) }
    }
    const attempts = row.attempts + 1
    if (outcome.kind === 'success') {
      await db.webhookDelivery.updateMany({
        where: { id: row.id, status: 'pending', leaseOwner: owner },
        data: {
          status: 'success', attempts, deliveredAt: now,
          responseStatus: outcome.responseStatus, lastError: null, nextAttemptAt: null, leaseOwner: null, leaseUntil: null,
        },
      })
      continue
    }

    const reason = outcome.error.slice(0, 300)
    if (attempts < MAX_ATTEMPTS) {
      const seconds = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)]!
      await db.webhookDelivery.updateMany({
        where: { id: row.id, status: 'pending', leaseOwner: owner },
        data: {
          attempts, lastError: reason, responseStatus: outcome.responseStatus,
          nextAttemptAt: new Date(now.getTime() + seconds * 1000), leaseOwner: null, leaseUntil: null,
        },
      })
      continue
    }

    // The terminal state, notification and realtime event commit together.
    // Conditional update prevents duplicate notification when two publishers race.
    await db.$transaction(async (tx) => {
      const updated = await tx.webhookDelivery.updateMany({
        where: { id: row.id, status: 'pending', leaseOwner: owner },
        data: {
          status: 'dead', attempts, lastError: reason,
          responseStatus: outcome.responseStatus, nextAttemptAt: null, leaseOwner: null, leaseUntil: null,
        },
      })
      if (updated.count === 0) return
      const title = 'Webhook em dead-letter'
      const body = `A entrega do evento "${row.eventType}" para ${endpoint.url} falhou após ${MAX_ATTEMPTS} tentativas e foi movida para dead-letter. Reprocesse pelo módulo Webhooks. Último erro: ${reason.slice(0, 160)}`
      const notification = await tx.notification.create({
        data: {
          tenantId: endpoint.tenantId, title, body, kind: 'webhook',
          module: 'webhooks', targetRole: 'tenant_admin',
          dedupeKey: `webhook.dead:${row.id}`,
        },
      })
      await tx.outboxEvent.create({
        data: {
          tenantId: endpoint.tenantId, eventType: 'notification.new',
          aggregateId: notification.id,
          internalPayload: JSON.stringify({
            notificationId: notification.id, title, body, kind: 'webhook',
            module: 'webhooks', targetRole: 'tenant_admin',
            createdAt: notification.createdAt.toISOString(), origin: 'cloud',
            aggregateVersion: 1, correlationId: notification.id,
          }),
        },
      })
    })
  }
  return processed
}
