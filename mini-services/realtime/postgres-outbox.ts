import type { PrismaClient, OutboxEvent } from '@prisma/client'

/**
 * PostgreSQL uses the durable pending state rather than an insertion cursor.
 * A sequence/ID cursor can skip a transaction that commits after a later one.
 * Run one realtime publisher per database until claiming/leases are implemented.
 * Delivery is at least once: a crash after emit and before update can replay.
 */
export async function publishPostgresOutboxBatch(
  db: PrismaClient,
  deliver: (event: OutboxEvent) => void | Promise<void>,
  limit = 50,
): Promise<OutboxEvent[]> {
  const events = await db.outboxEvent.findMany({
    where: { status: 'pending' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })

  const delivered: OutboxEvent[] = []
  for (const event of events) {
    await deliver(event)
    await db.outboxEvent.updateMany({
      where: { id: event.id, status: 'pending' },
      data: { status: 'published', publishedAt: new Date() },
    })
    delivered.push(event)
  }
  return delivered
}
