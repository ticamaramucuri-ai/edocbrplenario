import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as subscribe } from '@/app/api/v1/public/subscriptions/route'
import { processMailBatch, subscriptionTokenHash } from '@/lib/server/mail-delivery'
import { GET as queueGet, POST as queuePost } from '@/app/api/v1/mail-deliveries/route'

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

test('gestão da fila isola Câmaras, retoma apenas entrega vigente e audita sem token', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `mail-admin-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `mail-other-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin A', email: `admin-a-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const foreign = await db.user.create({ data: { tenantId: other.id, name: 'Admin B', email: `admin-b-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const token = crypto.randomUUID()
  const subscription = await db.citizenSubscription.create({ data: { tenantId: tenant.id, email: `citizen-${suffix}@example.invalid`, targetKind: 'session', targetId: 'ensaio', token } })
  const dead = await db.mailDelivery.create({ data: { tenantId: tenant.id, subscriptionId: subscription.id, tokenHash: subscriptionTokenHash(token), status: 'dead', attempts: 5, lastErrorCode: 'MAIL_DELIVERY_FAILED' } })
  const read = (actorId: string) => queueGet(new NextRequest('http://localhost/api/v1/mail-deliveries', { headers: { 'x-actor-id': actorId } }), { params: Promise.resolve({}) })
  const post = (actorId: string, id: string) => queuePost(new NextRequest('http://localhost/api/v1/mail-deliveries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify({ id }) }), { params: Promise.resolve({}) })
  const own = await read(admin.id)
  expect(own.status).toBe(200)
  const payload = await own.json()
  expect(payload.stats.dead).toBe(1)
  expect(payload.deliveries[0].id).toBe(dead.id)
  expect(JSON.stringify(payload)).not.toContain(token)
  expect(JSON.stringify(payload)).not.toContain(subscription.email)
  expect((await (await read(foreign.id)).json()).stats.dead).toBe(0)
  expect((await post(foreign.id, dead.id)).status).toBe(404)
  expect((await post(admin.id, dead.id)).status).toBe(200)
  expect((await post(admin.id, dead.id)).status).toBe(409)
  expect((await db.mailDelivery.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('pending')
  const audits = await db.auditEvent.findMany({ where: { tenantId: tenant.id, action: 'mail_delivery.requeued', aggregateId: dead.id } })
  expect(audits).toHaveLength(1)
  expect(JSON.stringify(audits)).not.toContain(token)
  const obsolete = await db.mailDelivery.create({ data: { tenantId: tenant.id, subscriptionId: subscription.id, tokenHash: subscriptionTokenHash('old-token'), status: 'dead', attempts: 5 } })
  expect((await post(admin.id, obsolete.id)).status).toBe(409)
  expect((await db.mailDelivery.findUniqueOrThrow({ where: { id: obsolete.id } })).status).toBe('dead')
})
