import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as amendAgenda } from '@/app/api/v1/sessions/[id]/agenda-amendments/route'
import { GET as myNotice, POST as acknowledge } from '@/app/api/v1/me/notices/route'
import { GET as recipients } from '@/app/api/v1/sessions/[id]/notice-recipients/route'

afterAll(async () => { await db.$disconnect() })
const request = (url: string, method: string, actorId: string, body?: unknown) => new NextRequest(url, {
  method, headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})

test('ciência é por Câmara e revisão, idempotente e vinculada ao hash vigente', async () => {
  const tenant = await db.tenant.create({ data: { slug: 'ciencia-a', name: 'Câmara A', city: 'A', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: 'ciencia-b', name: 'Câmara B', city: 'B', uf: 'BA' } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente', party: 'SEM', boardRole: 'presidente' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereadora', party: 'SEM' } })
  const outsider = await db.parliamentarian.create({ data: { tenantId: other.id, name: 'Outra vereadora', party: 'SEM' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: 'ciencia-admin@example.invalid', role: 'tenant_admin' } })
  const mine = await db.user.create({ data: { tenantId: tenant.id, name: 'Vereadora', email: 'ciencia-me@example.invalid', role: 'parliamentarian', parliamentarianId: member.id } })
  const foreign = await db.user.create({ data: { tenantId: other.id, name: 'Outra', email: 'ciencia-other@example.invalid', role: 'parliamentarian', parliamentarianId: outsider.id } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Matéria 1', authors: '[]' } })
  const another = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'requerimento', number: 2, year: 2026, ementa: 'Matéria 2', authors: '[]' } })
  const created = await createSession(request('http://localhost/api/v1/sessions', 'POST', admin.id, { type: 'ordinaria', scheduledAt: new Date(Date.now() + 86400000).toISOString(), presidentId: president.id, matterIds: [matter.id] }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const session = (await created.json()).session as { id: string; version: number }
  expect((await transitionSession(request(`http://localhost/api/v1/sessions/${session.id}/transition`, 'POST', admin.id, { action: 'schedule', version: session.version }), { params: Promise.resolve({ id: session.id }) })).status).toBe(200)
  const mineUrl = `http://localhost/api/v1/me/notices?sessionId=${session.id}`
  const read = (actorId: string) => myNotice(request(mineUrl, 'GET', actorId), { params: Promise.resolve({}) })
  expect((await read(foreign.id)).status).toBe(404)
  const first = (await (await read(mine.id)).json()).notice
  expect(first.revision).toBe(1)
  expect(first.acknowledgedAt).toBeNull()
  const ack = (actorId: string, body: unknown) => acknowledge(request('http://localhost/api/v1/me/notices', 'POST', actorId, body), { params: Promise.resolve({}) })
  expect((await ack(foreign.id, first)).status).toBe(404)
  expect((await ack(mine.id, { ...first, noticeSha256: '0'.repeat(64) })).status).toBe(409)
  expect((await ack(mine.id, first)).status).toBe(200)
  expect((await ack(mine.id, first)).status).toBe(200)
  expect(await db.auditEvent.count({ where: { tenantId: tenant.id, action: 'notice.acknowledged' } })).toBe(1)
  const report = await recipients(request(`http://localhost/api/v1/sessions/${session.id}/notice-recipients`, 'GET', admin.id), { params: Promise.resolve({ id: session.id }) })
  expect(report.status).toBe(200)
  expect(await report.json()).toMatchObject({ revision: 1, total: 2, acknowledged: 1 })
  expect((await recipients(request(`http://localhost/api/v1/sessions/${session.id}/notice-recipients`, 'GET', foreign.id), { params: Promise.resolve({ id: session.id }) })).status).toBe(403)
  const current = await db.session.findUniqueOrThrow({ where: { id: session.id } })
  expect((await amendAgenda(request(`http://localhost/api/v1/sessions/${session.id}/agenda-amendments`, 'POST', admin.id, { action: 'add', mode: 'apply', version: current.version, matterId: another.id, justification: 'Inclusão aprovada.' }), { params: Promise.resolve({ id: session.id }) })).status).toBe(201)
  expect((await ack(mine.id, first)).status).toBe(409)
  const second = (await (await read(mine.id)).json()).notice
  expect(second.revision).toBe(2)
  expect(second.acknowledgedAt).toBeNull()
  expect((await ack(mine.id, second)).status).toBe(200)
})
