import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import type { Parliamentarian } from '@prisma/client'
import { POST as changeImpediment, GET as listImpediments } from '@/app/api/v1/votings/[id]/impediments/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'

afterAll(async () => { await db.$disconnect() })

const call = (handler: typeof changeImpediment | typeof transitionVoting | typeof castVote,
  id: string, actorId: string, body: unknown) => handler(new NextRequest(`http://localhost/api/v1/votings/${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })

async function fixture(policy: string) {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `imp-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2, votingImpedimentPolicy: policy }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `op-${suffix}@example.invalid`, role: 'session_operator' } })
  const people: Parliamentarian[] = []
  for (let i = 0; i < 4; i++) people.push(await db.parliamentarian.create({ data: {
    tenantId: tenant.id, name: `Vereador ${i}`, party: 'SEM', order: i,
  } }))
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(), status: 'open' } })
  for (const person of people.slice(0, 3)) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Matéria de teste',
    mode: 'nominal', status: 'ready', rule: 'maioria_absoluta', requiredQuorum: 2 } })
  return { tenant, admin, operator, people, session, voting }
}

test('política desativada bloqueia registro; escopo de Câmara é respeitado', async () => {
  const a = await fixture('disabled')
  const b = await fixture('retain_base')
  expect((await call(changeImpediment, a.voting.id, a.admin.id, { action: 'register', version: 1,
    parliamentarianId: a.people[0].id, reason: 'Declaração formal registrada' })).status).toBe(409)
  expect((await call(changeImpediment, b.voting.id, a.admin.id, { action: 'register', version: 1,
    parliamentarianId: b.people[0].id, reason: 'Declaração formal registrada' })).status).toBe(403)
})

for (const policy of ['retain_base', 'reduce_base'] as const) test(`impedimento com ${policy} congela base, impede voto e apura corretamente`, async () => {
  const { tenant, admin, operator, people, voting } = await fixture(policy)
  const register = { action: 'register', version: 1, parliamentarianId: people[0].id, reason: 'Declaração formal registrada em ata' }
  expect((await call(changeImpediment, voting.id, admin.id, register)).status).toBe(200)
  expect((await call(changeImpediment, voting.id, admin.id, register)).status).toBe(409)
  const list = await listImpediments(new NextRequest(`http://localhost/api/v1/votings/${voting.id}/impediments`, {
    headers: { 'x-actor-id': admin.id },
  }), { params: Promise.resolve({ id: voting.id }) })
  expect((await list.json()).impediments).toHaveLength(1)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'open', version: 2 })).status).toBe(200)
  const opened = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(opened.presentAtOpen).toBe(2)
  expect(opened.memberBaseAtOpen).toBe(policy === 'reduce_base' ? 3 : 4)
  expect(opened.impedimentPolicyAtOpen).toBe(policy)
  expect(JSON.parse(opened.eligibleVoterIdsAtOpen ?? '[]')).not.toContain(people[0].id)
  expect((await call(changeImpediment, voting.id, admin.id, { ...register, action: 'revoke', version: 3 })).status).toBe(409)
  await db.tenant.update({ where: { id: tenant.id }, data: { settings: JSON.stringify({ quorumMinimum: 4, votingImpedimentPolicy: 'disabled' }) } })
  const vote = (personId: string) => call(castVote, voting.id, operator.id, {
    parliamentarianId: personId, value: 'sim', commandId: crypto.randomUUID(),
  })
  expect((await vote(people[0].id)).status).toBe(409)
  expect((await vote(people[1].id)).status).toBe(200)
  expect((await vote(people[2].id)).status).toBe(200)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'close', version: 3 })).status).toBe(200)
  const closed = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(closed.resultStatus).toBe(policy === 'reduce_base' ? 'aprovado' : 'rejeitado')
  expect(closed.memberBaseAtOpen).toBe(policy === 'reduce_base' ? 3 : 4)
  expect(await db.auditEvent.count({ where: { tenantId: tenant.id, action: 'voting.impediment_registered' } })).toBe(1)
})

test('revogação antes da abertura devolve parlamentar à base', async () => {
  const { admin, people, voting } = await fixture('retain_base')
  expect((await call(changeImpediment, voting.id, admin.id, { action: 'register', version: 1,
    parliamentarianId: people[0].id, reason: 'Declaração inicial registrada' })).status).toBe(200)
  expect((await call(changeImpediment, voting.id, admin.id, { action: 'revoke', version: 2,
    parliamentarianId: people[0].id, reason: 'Registro equivocado corrigido' })).status).toBe(200)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'open', version: 3 })).status).toBe(200)
  const opened = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(JSON.parse(opened.eligibleVoterIdsAtOpen ?? '[]')).toContain(people[0].id)
  expect(opened.impedimentPolicyAtOpen).toBeNull()
})

test('impedimento reduz presentes e impede abertura sem quórum; retomada preserva snapshot', async () => {
  const { admin, people, voting } = await fixture('retain_base')
  expect((await call(changeImpediment, voting.id, admin.id, { action: 'register', version: 1,
    parliamentarianId: people[0].id, reason: 'Declaração formal registrada em ata' })).status).toBe(200)
  expect((await call(changeImpediment, voting.id, admin.id, { action: 'register', version: 2,
    parliamentarianId: people[1].id, reason: 'Outra declaração formal registrada' })).status).toBe(200)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'open', version: 3 })).status).toBe(409)
  expect((await call(changeImpediment, voting.id, admin.id, { action: 'revoke', version: 3,
    parliamentarianId: people[1].id, reason: 'Registro corrigido pela Mesa' })).status).toBe(200)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'open', version: 4 })).status).toBe(200)
  const opened = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'pause', version: 5 })).status).toBe(200)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'open', version: 6 })).status).toBe(409)
  expect((await call(transitionVoting, voting.id, admin.id, { action: 'resume', version: 6 })).status).toBe(200)
  const resumed = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(resumed.eligibleVoterIdsAtOpen).toBe(opened.eligibleVoterIdsAtOpen)
  expect(resumed.memberBaseAtOpen).toBe(opened.memberBaseAtOpen)
})
