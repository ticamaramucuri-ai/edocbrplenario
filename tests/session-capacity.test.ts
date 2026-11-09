import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createVoting } from '@/app/api/v1/sessions/[id]/votings/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'
import { GET as publicSession } from '@/app/api/v1/public/sessions/[id]/route'

afterAll(async () => { await db.$disconnect() })
const post = (url: string, actorId: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body),
})
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

test('21 vereadores votam e 40 consultas públicas simultâneas veem o mesmo resultado', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `capacity-${suffix}`, name: 'Câmara de Ensaio', city: 'Teste', uf: 'BA', settings: JSON.stringify({ quorumMinimum: 11 }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Mesa', email: `mesa-${suffix}@example.invalid`, role: 'session_operator' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026, status: 'open', scheduledAt: new Date(), openedAt: new Date(), agendaPublished: true } })
  const item = await db.agendaItem.create({ data: { sessionId: session.id, order: 0, title: 'Votação de capacidade', status: 'em_leitura' } })
  const people: Array<{ id: string }> = []
  for (let index = 0; index < 21; index++) {
    const person = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: `Vereador ${index + 1}`, party: 'SEM', order: index } })
    people.push(person)
    await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: person.id,
      kind: 'check_in', status: 'presente', source: 'operador' } })
  }
  const created = await createVoting(post(`http://localhost/api/v1/sessions/${session.id}/votings`, admin.id,
    { agendaItemId: item.id, mode: 'nominal' }), ctx(session.id))
  expect(created.status).toBe(201)
  const votingId = (await created.json()).voting.id as string
  expect((await transitionVoting(post(`http://localhost/api/v1/votings/${votingId}/transition`, admin.id,
    { action: 'open', version: 1 }), ctx(votingId))).status).toBe(200)
  const started = performance.now()
  const times: number[] = []
  const votes = await Promise.all(people.map(async (person) => {
    const begin = performance.now()
    const response = await castVote(post(`http://localhost/api/v1/votings/${votingId}/votes`, operator.id,
      { parliamentarianId: person.id, value: 'sim', commandId: crypto.randomUUID() }), ctx(votingId))
    times.push(performance.now() - begin)
    return response
  }))
  const votingBatchMs = performance.now() - started
  expect(votes.map((response) => response.status)).toEqual(Array(21).fill(200))
  expect(await db.vote.count({ where: { votingId } })).toBe(21)
  expect((await transitionVoting(post(`http://localhost/api/v1/votings/${votingId}/transition`, admin.id,
    { action: 'close', version: 2 }), ctx(votingId))).status).toBe(200)
  const publicStart = performance.now()
  const publicResponses = await Promise.all(Array.from({ length: 40 }, () => publicSession(
    new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx(session.id))))
  expect(publicResponses.map((response) => response.status)).toEqual(Array(40).fill(200))
  const views = await Promise.all(publicResponses.map((response) => response.json()))
  expect(views.every((view) => view.votings.length === 1 && view.votings[0].resultCounts?.sim === 21)).toBe(true)
  const sorted = times.sort((a, b) => a - b)
  console.log(JSON.stringify({ capacityEvidence: { parliamentarians: 21, concurrentVotes: 21, publicReads: 40,
    votingBatchMs: Math.round(votingBatchMs), voteP95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    publicReadBatchMs: Math.round(performance.now() - publicStart), environment: 'direct route handlers, disposable database' } }))
}, 30_000)
