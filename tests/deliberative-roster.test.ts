import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { currentAttendance } from '@/lib/server/domain'
import { buildSessionDetail } from '@/lib/server/serializers'
import { POST as attendancePost } from '@/app/api/v1/sessions/[id]/attendance/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'

afterAll(async () => { await db.$disconnect() })
const request = (url: string, actorId: string, body: unknown) => new NextRequest(url, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })

test('base deliberativa substitui titular, bloqueia presença externa e congela votantes na abertura', async () => {
  const tenant = await db.tenant.create({ data: { slug: 'roster-policy-a', name: 'Câmara Roster', city: 'Cidade', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2, deliberativeRosterPolicy: 'mandate_and_leave' }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: 'roster-admin@example.invalid', role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: 'roster-operator@example.invalid', role: 'session_operator' } })
  const titular = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Titular', party: 'SEM' } })
  const suplente = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Suplente', party: 'SEM' } })
  const colega = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Colega', party: 'SEM' } })
  const semMandato = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Sem mandato', party: 'SEM' } })
  const legislature = await db.legislature.create({ data: { tenantId: tenant.id, number: 1, startYear: 2025, endYear: 2030 } })
  for (const person of [titular, colega]) await db.mandate.create({ data: { tenantId: tenant.id,
    parliamentarianId: person.id, legislatureId: legislature.id, startDate: new Date('2025-01-01T00:00:00Z') } })
  await db.leave.create({ data: { tenantId: tenant.id, parliamentarianId: titular.id, substituteId: suplente.id,
    kind: 'licenca', startDate: new Date('2025-01-01T00:00:00Z'), reason: 'Licença registrada' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(Date.now() + 86400000), status: 'open' } })
  const attendance = await currentAttendance(db, session.id, tenant.id)
  expect(attendance.rows.map((row) => row.parliamentarianId).sort()).toEqual([suplente.id, colega.id].sort())
  const attendanceUrl = `http://localhost/api/v1/sessions/${session.id}/attendance`
  expect((await attendancePost(request(attendanceUrl, admin.id,
    { parliamentarianId: semMandato.id, action: 'check_in' }), { params: Promise.resolve({ id: session.id }) })).status).toBe(409)
  for (const person of [suplente, colega]) await db.attendanceEvent.create({ data: { sessionId: session.id,
    parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador' } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Deliberação', mode: 'nominal',
    status: 'ready', rule: 'maioria_absoluta', requiredQuorum: 2 } })
  const transition = (action: string, version: number) => transitionVoting(request(
    `http://localhost/api/v1/votings/${voting.id}/transition`, admin.id, { action, version }),
  { params: Promise.resolve({ id: voting.id }) })
  expect((await transition('open', 1)).status).toBe(200)
  const opened = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(opened.memberBaseAtOpen).toBe(2)
  expect(JSON.parse(opened.eligibleVoterIdsAtOpen ?? '[]').sort()).toEqual([suplente.id, colega.id].sort())
  await db.tenant.update({ where: { id: tenant.id }, data: { settings: JSON.stringify({ quorumMinimum: 4,
    deliberativeRosterPolicy: 'active' }) } })
  const detail = await buildSessionDetail(db, await db.session.findUniqueOrThrow({ where: { id: session.id } }))
  expect(detail.quorum).toMatchObject({ total: 2, present: 2, required: 2, ok: true })
  const voteUrl = `http://localhost/api/v1/votings/${voting.id}/votes`
  const vote = (id: string, value: string) => castVote(request(voteUrl, operator.id,
    { parliamentarianId: id, value, commandId: crypto.randomUUID() }), { params: Promise.resolve({ id: voting.id }) })
  expect((await vote(semMandato.id, 'sim')).status).toBe(409)
  expect((await vote(suplente.id, 'sim')).status).toBe(200)
  expect((await vote(colega.id, 'sim')).status).toBe(200)
  expect((await transition('close', opened.version)).status).toBe(200)
  expect((await db.voting.findUniqueOrThrow({ where: { id: voting.id } })).resultStatus).toBe('aprovado')
})
