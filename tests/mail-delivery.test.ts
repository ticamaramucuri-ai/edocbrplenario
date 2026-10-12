import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as subscribe } from '@/app/api/v1/public/subscriptions/route'
import { processMailBatch, subscriptionTokenHash } from '@/lib/server/mail-delivery'

afterAll(async () => { await db.$disconnect() })

test('confirmação entra na fila sem vazar token; worker envia, tenta novamente e cancela token obsoleto', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `mail-${suffix}`, name: 'Câmara de Ensaio', city: 'Teste', uf: 'BA' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2039,
    status: 'scheduled', scheduledAt: new Date('2039-01-01T12:00:00Z') } })
  const request = (email: string) => subscribe(new NextRequest(`http://localhost/api/v1/public/subscriptions?tenant=${tenant.slug}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID() },
    body: JSON.stringify({ email, targetKind: 'session', targetId: session.id }),
  }), { params: Promise.resolve({}) })
  const first = await request(`citizen-${suffix}@example.invalid`)
  expect(first.status).toBe(201)
  const firstBody = await first.json()
  expect(firstBody.confirmationDelivery).toBe('awaiting_configuration')
  const sub = await db.citizenSubscription.findUniqueOrThrow({ where: { id: firstBody.subscription.id } })
  const queued = await db.mailDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })
  expect(queued.tokenHash).toBe(subscriptionTokenHash(sub.token))
  expect(JSON.stringify(queued)).not.toContain(sub.token)
  expect(JSON.stringify(firstBody)).not.toContain(sub.token)
  expect((await request(sub.email)).status).toBe(200)
  expect(await db.mailDelivery.count({ where: { subscriptionId: sub.id } })).toBe(1)
  const delivered: Array<{ to: string; text: string }> = []
  await processMailBatch(db, async ({ to, text }) => { delivered.push({ to, text }) }, 'http://localhost:3000')
  expect(delivered).toHaveLength(1)
  expect(delivered[0]?.text).toContain(`token=${sub.token}`)
  expect((await db.mailDelivery.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe('sent')
  await db.citizenSubscription.update({ where: { id: sub.id }, data: { revokedAt: new Date() } })
  const renewed = await request(sub.email)
  expect(renewed.status).toBe(201)
  const current = await db.citizenSubscription.findUniqueOrThrow({ where: { id: sub.id } })
  expect(current.token).not.toBe(sub.token)
  const renewedQueue = await db.mailDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id, status: 'pending' } })
  await processMailBatch(db, async () => { throw new Error('senha SMTP secreta') }, 'http://localhost:3000')
  const failed = await db.mailDelivery.findUniqueOrThrow({ where: { id: renewedQueue.id } })
  expect(failed.attempts).toBe(1)
  expect(failed.lastErrorCode).toBe('MAIL_DELIVERY_FAILED')
  expect(JSON.stringify(failed)).not.toContain('senha SMTP secreta')
  await db.citizenSubscription.update({ where: { id: sub.id }, data: { token: crypto.randomUUID() } })
  await processMailBatch(db, async () => { throw new Error('não deveria enviar token antigo') },
    'http://localhost:3000', new Date(Date.now() + 60_000))
  expect((await db.mailDelivery.findUniqueOrThrow({ where: { id: renewedQueue.id } })).status).toBe('canceled')
  const second = await request(`outra-${suffix}@example.invalid`)
  expect(second.status).toBe(201)
  let sends = 0
  await Promise.all([processMailBatch(db, async () => { sends++ }, 'http://localhost:3000'),
    processMailBatch(db, async () => { sends++ }, 'http://localhost:3000')])
  expect(sends).toBe(1)
})
