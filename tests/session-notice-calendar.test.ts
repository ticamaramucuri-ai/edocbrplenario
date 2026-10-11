import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as noticeCalendar } from '@/app/api/v1/sessions/notice-calendar/route'

afterAll(async () => { await db.$disconnect() })

test('calendário calcula prazos por fase, isola Câmaras e informa o fuso institucional', async () => {
  const a = await db.tenant.create({ data: { slug: 'calendario-a', name: 'Câmara A', city: 'A', uf: 'BA', timezone: 'America/Bahia',
    settings: JSON.stringify({ minimumNoticeHours: 24, minimumAmendmentHours: 8, urgentNoticeExceptionTypes: ['extraordinaria'] }) } })
  const b = await db.tenant.create({ data: { slug: 'calendario-b', name: 'Câmara B', city: 'B', uf: 'BA' } })
  const adminA = await db.user.create({ data: { tenantId: a.id, name: 'Admin A', email: 'calendario-a@example.invalid', role: 'tenant_admin' } })
  const adminB = await db.user.create({ data: { tenantId: b.id, name: 'Admin B', email: 'calendario-b@example.invalid', role: 'tenant_admin' } })
  const date = new Date(Date.now() + 5 * 60 * 60 * 1000)
  const draft = await db.session.create({ data: { tenantId: a.id, number: 1, year: 2026, type: 'ordinaria', scheduledAt: date } })
  const scheduled = await db.session.create({ data: { tenantId: a.id, number: 2, year: 2026, type: 'extraordinaria', scheduledAt: date, status: 'scheduled', agendaPublished: true } })
  await db.session.create({ data: { tenantId: b.id, number: 1, year: 2026, type: 'ordinaria', scheduledAt: date } })
  const read = (actorId: string) => noticeCalendar(new NextRequest('http://localhost/api/v1/sessions/notice-calendar', { headers: { 'x-actor-id': actorId } }), { params: Promise.resolve({}) })
  const responseA = await read(adminA.id)
  expect(responseA.status).toBe(200)
  const bodyA = await responseA.json()
  expect(bodyA.timezone).toBe('America/Bahia')
  expect(bodyA.rows).toHaveLength(2)
  expect(bodyA.rows.find((r: { sessionId: string }) => r.sessionId === draft.id)).toMatchObject({ phase: 'initial', minimumHours: 24, state: 'passed', exceptionAllowed: false })
  expect(bodyA.rows.find((r: { sessionId: string }) => r.sessionId === scheduled.id)).toMatchObject({ phase: 'amendment', minimumHours: 8, state: 'passed', exceptionAllowed: true })
  const responseB = await read(adminB.id)
  expect(responseB.status).toBe(200)
  const bodyB = await responseB.json()
  expect(bodyB.rows).toHaveLength(1)
  expect(bodyB.rows[0]).toMatchObject({ minimumHours: 0, state: 'due_soon', exceptionAllowed: false })
})
