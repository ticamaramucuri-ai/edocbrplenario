import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createVoting } from '@/app/api/v1/sessions/[id]/votings/route'
import { POST as votingTransition } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as sessionTransition } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, actorId: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
  body: JSON.stringify(body),
})

test('cancelamento restaura pauta; sessão não suspende/encerra com votação inconsistente', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `flow-${suffix}`, name: 'Câmara Fluxo', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 1 }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin',
    email: `admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador',
    email: `operator-${suffix}@example.invalid`, role: 'session_operator' } })
  const person = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereadora', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    status: 'open', scheduledAt: new Date(), openedAt: new Date() } })
  const item = await db.agendaItem.create({ data: { sessionId: session.id, order: 0, title: 'Matéria da pauta',
    status: 'em_leitura', resultSummary: 'Registro anterior preservado' } })
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: person.id,
    kind: 'check_in', status: 'presente', source: 'operador' } })
  const create = () => createVoting(request(`http://localhost/api/v1/sessions/${session.id}/votings`, admin.id,
    { agendaItemId: item.id, mode: 'nominal' }), { params: Promise.resolve({ id: session.id }) })
  const transitionVoting = (id: string, action: string, version: number, extra: object = {}) =>
    votingTransition(request(`http://localhost/api/v1/votings/${id}/transition`, admin.id,
      { action, version, ...extra }), { params: Promise.resolve({ id }) })
  const transitionSession = (action: string, version: number) => sessionTransition(request(
    `http://localhost/api/v1/sessions/${session.id}/transition`, admin.id, { action, version }),
  { params: Promise.resolve({ id: session.id }) })

  const first = await create()
  expect(first.status).toBe(201)
  const firstId = (await first.json()).voting.id as string
  expect((await create()).status).toBe(409)
  expect((await transitionSession('close', 1)).status).toBe(409)
  expect((await transitionVoting(firstId, 'cancel', 1)).status).toBe(422)
  expect((await transitionVoting(firstId, 'cancel', 1, { justification: 'Erro na apresentação da questão' })).status).toBe(200)
  expect((await db.voting.findUniqueOrThrow({ where: { id: firstId } })).status).toBe('cancelled')
  expect(await db.agendaItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
    status: 'em_leitura', resultSummary: 'Registro anterior preservado',
  })
  expect((await transitionVoting(firstId, 'open', 2)).status).toBe(409)
  const second = await create()
  expect(second.status).toBe(201)
  const secondId = (await second.json()).voting.id as string
  expect((await transitionVoting(secondId, 'open', 1)).status).toBe(200)
  expect((await transitionSession('suspend', 1)).status).toBe(409)
  expect((await transitionVoting(secondId, 'pause', 2)).status).toBe(200)
  expect((await transitionSession('suspend', 1)).status).toBe(200)
  expect((await transitionVoting(secondId, 'resume', 3)).status).toBe(409)
  expect((await transitionSession('close', 2)).status).toBe(409)
  expect((await transitionSession('resume', 2)).status).toBe(200)
  expect((await transitionVoting(secondId, 'resume', 3)).status).toBe(200)
  expect((await transitionSession('close', 3)).status).toBe(409)
  const commandId = crypto.randomUUID()
  const vote = await castVote(request(`http://localhost/api/v1/votings/${secondId}/votes`, operator.id,
    { parliamentarianId: person.id, value: 'sim', commandId }),
  { params: Promise.resolve({ id: secondId }) })
  expect(vote.status).toBe(200)
  const retry = () => castVote(request(`http://localhost/api/v1/votings/${secondId}/votes`, operator.id,
    { parliamentarianId: person.id, value: 'sim', commandId }),
  { params: Promise.resolve({ id: secondId }) })
  expect((await retry()).status).toBe(200)
  const changedPayload = await castVote(request(`http://localhost/api/v1/votings/${secondId}/votes`, operator.id,
    { parliamentarianId: person.id, value: 'nao', commandId }),
  { params: Promise.resolve({ id: secondId }) })
  expect(changedPayload.status).toBe(409)
  expect((await db.vote.findFirstOrThrow({ where: { votingId: secondId } })).value).toBe('sim')
  expect(await db.auditEvent.count({ where: { tenantId: tenant.id, action: 'vote.cast' } })).toBe(1)
  expect((await transitionVoting(secondId, 'close', 4)).status).toBe(200)
  expect((await transitionSession('close', 3)).status).toBe(200)
  expect((await create()).status).toBe(409)
  expect(await db.auditEvent.count({ where: { tenantId: tenant.id, action: 'voting.cancelled' } })).toBe(1)
})

test('voto rejeitado se a sessão estiver suspensa mesmo quando a votação legada continuar aberta', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `legacy-${suffix}`, name: 'Câmara Legado', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador',
    email: `op-${suffix}@example.invalid`, role: 'session_operator' } })
  const person = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereadora', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    status: 'suspended', scheduledAt: new Date() } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Legado aberto', status: 'open' } })
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: person.id,
    kind: 'check_in', status: 'presente', source: 'operador' } })
  const response = await castVote(request(`http://localhost/api/v1/votings/${voting.id}/votes`, operator.id,
    { parliamentarianId: person.id, value: 'sim', commandId: crypto.randomUUID() }),
  { params: Promise.resolve({ id: voting.id }) })
  expect(response.status).toBe(409)
})
