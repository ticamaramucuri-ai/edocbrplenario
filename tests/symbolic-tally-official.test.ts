import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as getTallies, POST as tally } from '@/app/api/v1/votings/[id]/symbolic-tally/route'
import { POST as transition } from '@/app/api/v1/votings/[id]/transition/route'

afterAll(async () => { await db.$disconnect() })

test('votação simbólica oficial exige segunda identidade e fecha com a revisão confirmada', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `tally-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 1 }) } })
  const other = await db.tenant.create({ data: { slug: `tally-other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const clerk = await db.user.create({ data: { tenantId: tenant.id, name: 'Secretaria', email: `clerk-${suffix}@example.invalid`, role: 'session_operator' } })
  const chair = await db.user.create({ data: { tenantId: tenant.id, name: 'Presidência', email: `chair-${suffix}@example.invalid`, role: 'presiding_officer' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Fora', email: `outside-${suffix}@example.invalid`, role: 'session_operator' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Membro', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2037,
    scheduledAt: new Date('2037-01-01T12:00:00.000Z'), status: 'open', official: true } })
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente' } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Aprovar?', mode: 'simbolico', status: 'open',
    rule: 'maioria_simples', requiredQuorum: 1, quorumAtOpen: 1, memberBaseAtOpen: 1, presentAtOpen: 1,
    eligibleVoterIdsAtOpen: JSON.stringify([member.id]), version: 2 } })
  const url = `http://localhost/api/v1/votings/${voting.id}`
  const ctx = { params: Promise.resolve({ id: voting.id }) }
  const request = (actorId: string, path: string, body: unknown) => new NextRequest(`${url}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
  const postTally = (actorId: string, body: unknown) => tally(request(actorId, 'symbolic-tally', body), ctx)
  const close = (actorId: string, body: unknown) => transition(request(actorId, 'transition', body), ctx)
  expect((await close(clerk.id, { action: 'close', version: 2, sim: 1, nao: 0, abstencoes: 0 })).status).toBe(409)
  expect((await postTally(outsider.id, { action: 'propose', version: 2, sim: 1, nao: 0, abstencoes: 0 })).status).toBe(403)
  const proposal = await postTally(clerk.id, { action: 'propose', version: 2, sim: 1, nao: 0, abstencoes: 0 })
  expect(proposal.status).toBe(200)
  const proposed = await proposal.json()
  expect(proposed.version).toBe(3)
  expect((await close(clerk.id, { action: 'close', version: 3 })).status).toBe(409)
  expect((await postTally(clerk.id, { action: 'confirm', version: 3, revisionId: proposed.revision.id })).status).toBe(403)
  const confirmed = await postTally(chair.id, { action: 'confirm', version: 3, revisionId: proposed.revision.id })
  expect(confirmed.status).toBe(200)
  expect((await confirmed.json()).version).toBe(4)
  expect((await postTally(clerk.id, { action: 'propose', version: 4, sim: 0, nao: 1, abstencoes: 0 })).status).toBe(409)
  expect((await close(clerk.id, { action: 'close', version: 4, sim: 0, nao: 1, abstencoes: 0 })).status).toBe(422)
  expect((await close(clerk.id, { action: 'close', version: 4 })).status).toBe(200)
  const final = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(final.resultStatus).toBe('aprovado')
  expect(JSON.parse(final.resultCounts ?? '{}').sim).toBe(1)
  const listed = await getTallies(new NextRequest(`${url}/symbolic-tally`, { headers: { 'x-actor-id': chair.id } }), ctx)
  expect((await listed.json()).revisions[0].confirmedByName).toBe('Presidência')
  expect(await db.symbolicTallyRevision.count({ where: { votingId: voting.id } })).toBe(1)
})

test('contagem simbólica oficial customizada exige chaves exatas, quórum e confirmação independente', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `tally-custom-${suffix}`, name: 'Câmara Opções', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2 }) } })
  const clerk = await db.user.create({ data: { tenantId: tenant.id, name: 'Secretaria', email: `custom-clerk-${suffix}@example.invalid`, role: 'session_operator' } })
  const chair = await db.user.create({ data: { tenantId: tenant.id, name: 'Presidência', email: `custom-chair-${suffix}@example.invalid`, role: 'presiding_officer' } })
  const people = await Promise.all(['Membro A', 'Membro B', 'Membro C'].map((name, order) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name, party: 'ENSAIO', order },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2037,
    scheduledAt: new Date('2037-01-01T12:00:00.000Z'), status: 'open', official: true } })
  for (const person of people) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Deliberação por opção?', mode: 'simbolico', status: 'open',
    rule: 'maioria_simples', requiredQuorum: 2, quorumAtOpen: 2, memberBaseAtOpen: 3, presentAtOpen: 3,
    eligibleVoterIdsAtOpen: JSON.stringify(people.map((person) => person.id)), version: 2 } })
  const options = [{ key: 'a_favor', label: 'A favor', order: 0 }, { key: 'contra', label: 'Contra', order: 1 }]
  await db.votingOption.createMany({ data: options.map((option) => ({ votingId: voting.id, ...option })) })
  const url = `http://localhost/api/v1/votings/${voting.id}`
  const ctx = { params: Promise.resolve({ id: voting.id }) }
  const request = (actorId: string, path: string, body: unknown) => new NextRequest(`${url}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
  const propose = (body: unknown) => tally(request(clerk.id, 'symbolic-tally', body), ctx)
  const confirm = (actorId: string, body: unknown) => tally(request(actorId, 'symbolic-tally', body), ctx)
  const close = (body: unknown) => transition(request(clerk.id, 'transition', body), ctx)

  expect((await propose({ action: 'propose', version: 2, customCounts: { a_favor: 2 } })).status).toBe(422)
  expect((await propose({ action: 'propose', version: 2, customCounts: { a_favor: 2, contra: 2 } })).status).toBe(422)
  expect(await db.symbolicTallyRevision.count({ where: { votingId: voting.id } })).toBe(0)

  const proposed = await propose({ action: 'propose', version: 2, customCounts: { a_favor: 2, contra: 1 } })
  expect(proposed.status).toBe(200)
  const proposal = await proposed.json()
  expect(proposal.revision.counts).toEqual({ a_favor: 2, contra: 1 })
  expect((await close({ action: 'close', version: 3 })).status).toBe(409)
  expect((await confirm(clerk.id, { action: 'confirm', version: 3, revisionId: proposal.revision.id })).status).toBe(403)
  const confirmed = await confirm(chair.id, { action: 'confirm', version: 3, revisionId: proposal.revision.id })
  expect(confirmed.status).toBe(200)
  expect((await confirmed.json()).revision.confirmedByName).toBe('Presidência')
  const closed = await close({ action: 'close', version: 4 })
  expect(closed.status).toBe(200)

  const final = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(final).toMatchObject({ status: 'closed', resultStatus: 'aprovado', presentAtClose: 3 })
  expect(JSON.parse(final.resultCounts ?? '{}')).toMatchObject({
    custom: { a_favor: 2, contra: 1 }, presentes: 3, naoRegistraram: 0,
  })
  const listed = await getTallies(new NextRequest(`${url}/symbolic-tally`, { headers: { 'x-actor-id': chair.id } }), ctx)
  expect((await listed.json()).revisions[0]).toMatchObject({ counts: { a_favor: 2, contra: 1 }, confirmedByName: 'Presidência' })
})

test('empate simbólico oficial customizado persiste o empate e cita somente opções empatadas', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `tally-tie-${suffix}`, name: 'Câmara Empate', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 3 }) } })
  const clerk = await db.user.create({ data: { tenantId: tenant.id, name: 'Secretaria', email: `tie-clerk-${suffix}@example.invalid`, role: 'session_operator' } })
  const chair = await db.user.create({ data: { tenantId: tenant.id, name: 'Presidência', email: `tie-chair-${suffix}@example.invalid`, role: 'presiding_officer' } })
  const people = await Promise.all(Array.from({ length: 5 }, (_, order) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name: `Membro ${order + 1}`, party: 'ENSAIO', order },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2037,
    scheduledAt: new Date('2037-01-01T12:00:00.000Z'), status: 'open', official: true } })
  for (const person of people) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const item = await db.agendaItem.create({ data: { sessionId: session.id, order: 0, title: 'Deliberação simbólica' } })
  const voting = await db.voting.create({ data: { sessionId: session.id, agendaItemId: item.id, question: 'Qual opção?', mode: 'simbolico', status: 'open',
    rule: 'maioria_simples', requiredQuorum: 3, quorumAtOpen: 3, memberBaseAtOpen: 5, presentAtOpen: 5,
    eligibleVoterIdsAtOpen: JSON.stringify(people.map((person) => person.id)), version: 2 } })
  const url = `http://localhost/api/v1/votings/${voting.id}`
  const ctx = { params: Promise.resolve({ id: voting.id }) }
  const request = (actorId: string, path: string, body: unknown) => new NextRequest(`${url}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
  const options = [
    { key: 'a_favor', label: 'A favor', order: 0 },
    { key: 'contra', label: 'Contra', order: 1 },
    { key: 'adiar', label: 'Adiar', order: 2 },
  ]
  await db.votingOption.createMany({ data: options.map((option) => ({ votingId: voting.id, ...option })) })
  const proposedResponse = await tally(request(clerk.id, 'symbolic-tally', {
    action: 'propose', version: 2, customCounts: { a_favor: 2, contra: 2, adiar: 1 },
  }), ctx)
  expect(proposedResponse.status).toBe(200)
  const proposal = await proposedResponse.json()
  const confirmedResponse = await tally(request(chair.id, 'symbolic-tally', {
    action: 'confirm', version: 3, revisionId: proposal.revision.id,
  }), ctx)
  expect(confirmedResponse.status).toBe(200)
  const closed = await transition(request(clerk.id, 'transition', { action: 'close', version: 4 }), ctx)
  expect(closed.status).toBe(200)

  const result = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(result).toMatchObject({ status: 'closed', resultStatus: 'empate' })
  expect(JSON.parse(result.resultCounts ?? '{}')).toMatchObject({
    custom: { a_favor: 2, contra: 2, adiar: 1 }, presentes: 5, naoRegistraram: 0,
  })
  expect((await db.agendaItem.findUniqueOrThrow({ where: { id: item.id } })).resultSummary)
    .toBe('Empate entre as opções mais votadas (2 votos “A favor”, 2 votos “Contra”).')
})

test('propostas simbólicas concorrentes com a mesma versão produzem uma única revisão', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `tally-race-${suffix}`, name: 'Câmara Concorrência', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2 }) } })
  const operators = await Promise.all(['Secretaria A', 'Secretaria B'].map((name, index) => db.user.create({
    data: { tenantId: tenant.id, name, email: `race-${index}-${suffix}@example.invalid`, role: 'session_operator' },
  })))
  const people = await Promise.all(['Membro A', 'Membro B'].map((name, order) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name, party: 'ENSAIO', order },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2037,
    scheduledAt: new Date('2037-01-01T12:00:00.000Z'), status: 'open', official: true } })
  for (const person of people) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Contagem concorrente?', mode: 'simbolico', status: 'open',
    rule: 'maioria_simples', requiredQuorum: 2, quorumAtOpen: 2, memberBaseAtOpen: 2, presentAtOpen: 2,
    eligibleVoterIdsAtOpen: JSON.stringify(people.map((person) => person.id)), version: 7 } })
  await db.votingOption.createMany({ data: [
    { votingId: voting.id, key: 'a_favor', label: 'A favor', order: 0 },
    { votingId: voting.id, key: 'contra', label: 'Contra', order: 1 },
  ] })
  const ctx = { params: Promise.resolve({ id: voting.id }) }
  const responses = await Promise.all(operators.map((operator, index) => tally(new NextRequest(
    `http://localhost/api/v1/votings/${voting.id}/symbolic-tally`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': operator.id },
      body: JSON.stringify({ action: 'propose', version: 7,
        customCounts: index === 0 ? { a_favor: 2, contra: 0 } : { a_favor: 0, contra: 2 } }),
    }), ctx)))
  const statuses = responses.map((response) => response.status).sort((a, b) => a - b)
  expect(statuses).toEqual([200, 409])
  const [revisions, current] = await Promise.all([
    db.symbolicTallyRevision.findMany({ where: { votingId: voting.id } }),
    db.voting.findUniqueOrThrow({ where: { id: voting.id } }),
  ])
  expect(revisions).toHaveLength(1)
  expect(revisions[0].revision).toBe(1)
  const winnerCounts = JSON.parse(revisions[0].countsJson)
  expect(
    (winnerCounts.a_favor === 2 && winnerCounts.contra === 0) ||
    (winnerCounts.a_favor === 0 && winnerCounts.contra === 2)
  ).toBe(true)
  expect(current.version).toBe(8)
  expect(await db.auditEvent.count({ where: { aggregateType: 'voting', aggregateId: voting.id,
    action: 'voting.symbolic_tally.proposed' } })).toBe(1)
})
