import { afterAll, expect, test } from 'bun:test'
import type { PrismaClient } from '@prisma/client'
import { publishPostgresOutboxBatch } from '../mini-services/realtime/postgres-outbox'

const clientModule = await import(process.env.POSTGRES_TEST_CLIENT!)
const db = new clientModule.PrismaClient() as PrismaClient
afterAll(async () => { await db.$disconnect() })

test('outbox PostgreSQL entrega payload por Câmara, confirma e tenta novamente após falha', async () => {
  const suffix = crypto.randomUUID()
  const a = await db.tenant.create({ data: { slug: `rt-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const b = await db.tenant.create({ data: { slug: `rt-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const events = await Promise.all([a, b].map((tenant, index) => db.outboxEvent.create({
    data: {
      tenantId: tenant.id,
      eventType: 'test.pg',
      aggregateId: tenant.id,
      internalPayload: JSON.stringify({ tenantId: tenant.id, secret: 'interno' }),
      publicPayload: JSON.stringify({ tenantId: tenant.id }),
      createdAt: new Date(Date.now() + index * 1000),
    },
  })))
  const first = events[0]!
  const second = events[1]!
  const seen: string[] = []
  await expect(publishPostgresOutboxBatch(db, (event) => {
    seen.push(event.id)
    throw new Error('emissão indisponível')
  })).rejects.toThrow('emissão indisponível')
  expect(seen).toEqual([first.id])
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('pending')

  const delivered = await publishPostgresOutboxBatch(db, (event) => {
    seen.push(event.id)
    expect(JSON.parse(event.internalPayload).tenantId).toBe(event.tenantId)
    expect(JSON.parse(event.publicPayload!).tenantId).toBe(event.tenantId)
    expect(JSON.parse(event.publicPayload!)).not.toHaveProperty('secret')
  })
  expect(delivered.map((event) => event.id)).toEqual([first.id, second.id])
  expect(seen).toEqual([first.id, first.id, second.id])
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: second.id } })).publishedAt).toBeInstanceOf(Date)
  expect(await publishPostgresOutboxBatch(db, () => { throw new Error('não deve reemitir') })).toEqual([])
})
