import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createKey, GET as listKeys } from '@/app/api/v1/api-keys/route'
import { DELETE as revokeKey } from '@/app/api/v1/api-keys/[id]/route'
import { GET as externalMatters } from '@/app/api/v1/external/matters/route'
import { GET as listSessions } from '@/app/api/v1/auth/sessions/route'
import { DELETE as revokeSession } from '@/app/api/v1/auth/sessions/[id]/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, actorId: string, method = 'GET', body?: unknown) => new NextRequest(url, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const context = (id: string) => ({ params: Promise.resolve({ id }) })

test('API keys são reveladas uma vez; sessões e revogações ficam no escopo do usuário/tenant', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `access-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `access-out-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `access-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `access-op-${suffix}@example.invalid`, role: 'session_operator' } })
  const otherAdmin = await db.user.create({ data: { tenantId: other.id, name: 'Admin B', email: `access-out-${suffix}@example.invalid`, role: 'tenant_admin' } })

  const keysUrl = 'http://localhost/api/v1/api-keys'
  const create = (actorId: string, body: unknown) => createKey(request(keysUrl, actorId, 'POST', body), { params: Promise.resolve({}) })
  expect((await create(operator.id, { name: 'Leitura de matérias', scopes: ['matters.read'] })).status).toBe(403)
  expect((await create(admin.id, { name: 'Chave sem escopo', scopes: [] })).status).toBe(422)
  const issued = await create(admin.id, { name: 'Leitura externa', scopes: ['matters.read', 'calendar.read'] })
  expect(issued.status).toBe(200)
  const issuance = await issued.json()
  expect(issuance.secret).toMatch(/^legk_[A-Za-z0-9_-]{24}$/)
  expect(issuance.key).toMatchObject({ name: 'Leitura externa', scopes: ['matters.read', 'calendar.read'], revokedAt: null })
  expect(JSON.stringify(issuance.key)).not.toContain(issuance.secret)
  const keyId = issuance.key.id as string
  const stored = await db.apiKey.findUniqueOrThrow({ where: { id: keyId } })
  expect(stored.hash).not.toBe(issuance.secret)
  expect(stored.hash).toHaveLength(64)
  const listing = await listKeys(request(keysUrl, admin.id), { params: Promise.resolve({}) })
  const listBody = await listing.json()
  expect(listBody.keys).toHaveLength(1)
  expect(JSON.stringify(listBody)).not.toContain(issuance.secret)
  expect(JSON.stringify(listBody)).not.toContain(stored.hash)
  await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'requerimento', number: 1, year: 2026, ementa: 'Matéria que pertence à Câmara A', authors: '["Ana"]' } })
  await db.legislativeMatter.create({ data: { tenantId: other.id, type: 'requerimento', number: 1, year: 2026, ementa: 'Matéria privada da Câmara B', authors: '["Bruno"]' } })
  const externalRequest = (authorization: string, query = '') => new NextRequest(`http://localhost/api/v1/external/matters${query}`, { headers: { authorization } })
  const external = await externalMatters(externalRequest(`Bearer ${issuance.secret}`, '?page=1&pageSize=1'), { params: Promise.resolve({}) })
  expect(external.status).toBe(200)
  expect(await external.json()).toMatchObject({ page: 1, pageSize: 1, total: 1, data: [{ ementa: 'Matéria que pertence à Câmara A' }] })
  expect((await externalMatters(externalRequest('Bearer inválida'), { params: Promise.resolve({}) })).status).toBe(401)
  const calendarOnly = await create(admin.id, { name: 'Somente calendário', scopes: ['calendar.read'] })
  const calendarSecret = (await calendarOnly.json()).secret as string
  expect((await externalMatters(externalRequest(`Bearer ${calendarSecret}`), { params: Promise.resolve({}) })).status).toBe(403)
  const removeKey = (actorId: string) => revokeKey(request(`http://localhost/api/v1/api-keys/${keyId}`, actorId, 'DELETE'), context(keyId))
  expect((await removeKey(otherAdmin.id)).status).toBe(404)
  expect((await removeKey(admin.id)).status).toBe(200)
  const revokedAt = (await db.apiKey.findUniqueOrThrow({ where: { id: keyId } })).revokedAt?.getTime()
  expect((await removeKey(admin.id)).status).toBe(200)
  expect((await db.apiKey.findUniqueOrThrow({ where: { id: keyId } })).revokedAt?.getTime()).toBe(revokedAt)
  expect(await db.auditEvent.count({ where: { aggregateId: keyId, action: { startsWith: 'apikey.' } } })).toBe(2)
  expect((await externalMatters(externalRequest(`Bearer ${issuance.secret}`), { params: Promise.resolve({}) })).status).toBe(401)

  const expiresAt = new Date(Date.now() + 3600000)
  const ownSession = await db.authSession.create({ data: { userId: admin.id, tokenHash: `own-${suffix}`, expiresAt, userAgent: 'fixture browser' } })
  await db.authSession.create({ data: { userId: admin.id, tokenHash: `expired-${suffix}`, expiresAt: new Date(Date.now() - 1000) } })
  await db.authSession.create({ data: { userId: admin.id, tokenHash: `revoked-${suffix}`, expiresAt, revokedAt: new Date() } })
  const foreignSession = await db.authSession.create({ data: { userId: operator.id, tokenHash: `foreign-${suffix}`, expiresAt } })
  const sessionsUrl = 'http://localhost/api/v1/auth/sessions'
  const sessionsResponse = await listSessions(request(sessionsUrl, admin.id), { params: Promise.resolve({}) })
  expect(sessionsResponse.status).toBe(200)
  const activeSessions = (await sessionsResponse.json()).sessions as Array<{ id: string; current: boolean }>
  expect(activeSessions.map((session) => session.id)).toEqual([ownSession.id])
  expect(activeSessions[0]?.current).toBe(false)
  const removeSession = (id: string) => revokeSession(request(`http://localhost/api/v1/auth/sessions/${id}`, admin.id, 'DELETE'), context(id))
  expect((await removeSession(foreignSession.id)).status).toBe(404)
  expect((await removeSession(ownSession.id)).status).toBe(200)
  expect((await removeSession(ownSession.id)).status).toBe(200)
  expect((await db.authSession.findUniqueOrThrow({ where: { id: ownSession.id } })).revokedAt).not.toBeNull()
})
