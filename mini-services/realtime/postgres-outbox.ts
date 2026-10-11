import type { PrismaClient, OutboxEvent } from '@prisma/client'

/**
 * PostgreSQL uses the durable pending state rather than an insertion cursor.
 * A sequence/ID cursor can skip a transaction that commits after a later one.
 * Conditional claims allow multiple publishers. Delivery remains at least once:
 * a crash after emit and before confirmation can replay the same event ID.
 */
export async function publishPostgresOutboxBatch(
  db: PrismaClient,
  deliver: (event: OutboxEvent) => void | Promise<void>,
  limit = 50,
): Promise<OutboxEvent[]> {
  const owner = crypto.randomUUID()
  const now = new Date()
  const events = await db.outboxEvent.findMany({
    where: { status: 'pending', OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })

  const delivered: OutboxEvent[] = []
  for (const event of events) {
    const claim = await db.outboxEvent.updateMany({
      where: { id: event.id, status: 'pending', OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
      data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 60_000) },
    })
    if (!claim.count) continue
    try {
      await deliver(event)
      const confirmed = await db.outboxEvent.updateMany({
        where: { id: event.id, status: 'pending', leaseOwner: owner },
        data: { status: 'published', publishedAt: new Date(), leaseOwner: null, leaseUntil: null },
      })
      if (confirmed.count) delivered.push(event)
    } catch (error) {
      await db.outboxEvent.updateMany({ where: { id: event.id, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null } })
      throw error
    }
  }
  return delivered
}
