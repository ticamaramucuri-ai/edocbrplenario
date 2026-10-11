import { afterAll, expect, test } from 'bun:test'
import type { PrismaClient } from '@prisma/client'
import { processPostgresWebhookBatch } from '../mini-services/webhooks/postgres-delivery'

const clientModule = await import(process.env.POSTGRES_TEST_CLIENT!)
const db = new clientModule.PrismaClient() as PrismaClient
afterAll(async () => { await db.$disconnect() })

test('webhooks PostgreSQL: sucesso, retry, dead-letter atômico e endpoint inativo', async () => {
  const suffix = crypto.randomUUID()
  const now = new Date()
  const a = await db.tenant.create({ data: { slug: `wh-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const b = await db.tenant.create({ data: { slug: `wh-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const endpointA = await db.webhookEndpoint.create({ data: { tenantId: a.id, url: 'https://example.invalid/a', secret: 'test', events: '["test.pg"]' } })
  const endpointB = await db.webhookEndpoint.create({ data: { tenantId: b.id, url: 'https://example.invalid/b', secret: 'test', events: '["test.pg"]', active: false } })
  const make = (endpointId: string, eventType: string, attempts = 0) => db.webhookDelivery.create({
    data: { endpointId, eventType, payload: '{}', attempts, createdAt: new Date(now.getTime() - 1000) },
  })
  const success = await make(endpointA.id, 'test.success')
  const retry = await make(endpointA.id, 'test.retry')
  const dead = await make(endpointA.id, 'test.dead', 4)
  const inactive = await make(endpointB.id, 'test.inactive')
  const sent: string[] = []
  const count = await processPostgresWebhookBatch(db, async (endpoint, delivery) => {
    expect(endpoint.tenantId).toBe(a.id)
    sent.push(delivery.id)
    return delivery.id === success.id
      ? { kind: 'success', responseStatus: 204 }
      : { kind: 'failure', responseStatus: 503, error: 'indisponível' }
  }, now)
  expect(count).toBe(4)
  expect(sent).toHaveLength(3)
  expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: success.id } })).toMatchObject({ status: 'success', attempts: 1, responseStatus: 204 })
  expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: retry.id } })).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 503 })
  expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id: retry.id } })).nextAttemptAt?.getTime()).toBe(now.getTime() + 5000)
  expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: dead.id } })).toMatchObject({ status: 'dead', attempts: 5 })
  expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: inactive.id } })).toMatchObject({ status: 'pending', attempts: 0 })
  expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id: inactive.id } })).nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000)

  const notifications = await db.notification.findMany({ where: { dedupeKey: `webhook.dead:${dead.id}` } })
  expect(notifications).toHaveLength(1)
  expect(notifications[0]?.tenantId).toBe(a.id)
  const events = await db.outboxEvent.findMany({ where: { aggregateId: notifications[0]!.id } })
  expect(events).toHaveLength(1)
  expect(events[0]?.tenantId).toBe(a.id)
  expect(events[0]?.publicPayload).toBeNull()

  await processPostgresWebhookBatch(db, async (_endpoint, delivery) => {
    expect(delivery.id).toBe(retry.id)
    return { kind: 'success', responseStatus: 200 }
  }, new Date(now.getTime() + 6000))
  expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: retry.id } })).toMatchObject({ status: 'success', attempts: 2 })
  expect(await db.notification.count({ where: { dedupeKey: `webhook.dead:${dead.id}` } })).toBe(1)
})
