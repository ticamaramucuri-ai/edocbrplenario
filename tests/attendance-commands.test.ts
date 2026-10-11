import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as attendance } from '@/app/api/v1/sessions/[id]/attendance/route'
import { POST as selfCheckIn } from '@/app/api/v1/me/check-in/route'

afterAll(async () => { await db.$disconnect() })

function post(url: string, actorId: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
}

test('presença oficial exige chave, repete sem novo evento e rejeita origem não verificada', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `attendance-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `attendance-other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `operator-${suffix}@example.invalid`, role: 'session_operator' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Membro', party: 'SEM' } })
  const foreign = await db.parliamentarian.create({ data: { tenantId: other.id, name: 'Outro', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2035,
    scheduledAt: new Date('2035-01-01T12:00:00.000Z'), status: 'check_in', official: true } })
  const url = `http://localhost/api/v1/sessions/${session.id}/attendance`
  const context = { params: Promise.resolve({ id: session.id }) }
  const send = (body: unknown) => attendance(post(url, operator.id, body), context)
  expect((await send({ parliamentarianId: member.id, action: 'check_in' })).status).toBe(422)
  expect((await send({ parliamentarianId: member.id, action: 'check_in', commandId: crypto.randomUUID(), source: 'qr' })).status).toBe(422)
  expect((await send({ parliamentarianId: foreign.id, action: 'check_in', commandId: crypto.randomUUID() })).status).toBe(403)
  const commandId = crypto.randomUUID()
  const body = { parliamentarianId: member.id, action: 'check_in', commandId }
  const first = await send(body)
  expect(first.status).toBe(200)
  expect((await first.json()).replay).toBe(false)
  const second = await send(body)
  expect(second.status).toBe(200)
  expect((await second.json()).replay).toBe(true)
  expect(await db.attendanceEvent.count({ where: { sessionId: session.id } })).toBe(1)
  expect((await send({ ...body, action: 'check_out' })).status).toBe(409)
  expect(await db.attendanceEvent.count({ where: { sessionId: session.id } })).toBe(1)
})

test('auto check-in oficial usa identidade do parlamentar e chave idempotente', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `self-attendance-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Membro', party: 'SEM' } })
  const actor = await db.user.create({ data: { tenantId: tenant.id, parliamentarianId: member.id,
    name: 'Membro', email: `member-${suffix}@example.invalid`, role: 'parliamentarian' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2036,
    scheduledAt: new Date('2036-01-01T12:00:00.000Z'), status: 'check_in', official: true } })
  const send = (body: unknown) => selfCheckIn(post('http://localhost/api/v1/me/check-in', actor.id, body), { params: Promise.resolve({}) })
  expect((await send({})).status).toBe(422)
  const commandId = crypto.randomUUID()
  const first = await send({ commandId })
  expect(first.status).toBe(200)
  expect((await first.json()).replay).toBe(false)
  const repeat = await send({ commandId })
  expect(repeat.status).toBe(200)
  expect((await repeat.json()).replay).toBe(true)
  expect(await db.attendanceEvent.count({ where: { sessionId: session.id } })).toBe(1)
})
