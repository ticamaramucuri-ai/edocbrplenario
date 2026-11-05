import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import type { Parliamentarian } from '@prisma/client'
import { db } from '@/lib/db'
import { POST as changeImpediment } from '@/app/api/v1/votings/[id]/impediments/route'
import { POST as transition } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'
import { POST as attendancePost } from '@/app/api/v1/sessions/[id]/attendance/route'
import { POST as symbolicTally } from '@/app/api/v1/votings/[id]/symbolic-tally/route'
import { GET as publicSession } from '@/app/api/v1/public/sessions/[id]/route'
import { GET as ataReport } from '@/app/api/v1/reports/session/[id]/ata/route'

afterAll(async () => { await db.$disconnect() })

type Ballot = 'sim' | 'nao' | 'abstencao'
type Rule = 'maioria_absoluta' | 'maioria_simples'

// Apuração de papel independente: só usa os votos declarados no cenário e a
// base/quórum esperados. Não lê o snapshot nem importa o motor do produto.
function paperResult(ballots: Ballot[], present: number, seats: number, quorum: number, rule: Rule) {
  const sim = ballots.filter((vote) => vote === 'sim').length
  const nao = ballots.filter((vote) => vote === 'nao').length
  const abstencoes = ballots.filter((vote) => vote === 'abstencao').length
  const resultStatus = present < quorum ? 'sem_quorum'
    : rule === 'maioria_absoluta' ? (sim * 2 > seats ? 'aprovado' : 'rejeitado')
      : sim === nao ? 'empate' : sim > nao ? 'aprovado' : 'rejeitado'
  return { resultStatus, counts: { sim, nao, abstencoes,
    naoRegistraram: present - ballots.length, presentes: present } }
}

const post = (id: string, path: string, actorId: string, body: object) => new NextRequest(
  `http://localhost/api/v1/votings/${id}/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const act = (id: string, actorId: string, body: object) => transition(post(id, 'transition', actorId, body), ctx(id))

test('livro de papel: licença, suplente e impedimento preservam a base da maioria absoluta', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `paper-a-${suffix}`, name: 'Câmara Fictícia A',
    city: 'Teste', uf: 'BA', settings: JSON.stringify({ quorumMinimum: 2,
      deliberativeRosterPolicy: 'mandate_and_leave', votingImpedimentPolicy: 'retain_base' }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Mesa A',
    email: `paper-admin-a-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador A',
    email: `paper-op-a-${suffix}@example.invalid`, role: 'session_operator' } })
  const names = ['Titular licenciado', 'Suplente', 'Vereador B', 'Vereadora C', 'Vereador impedido']
  const people: Parliamentarian[] = []
  for (const [order, name] of names.entries()) people.push(await db.parliamentarian.create({
    data: { tenantId: tenant.id, name, party: 'SEM', order },
  }))
  const legislature = await db.legislature.create({ data: { tenantId: tenant.id,
    number: 1, startYear: 2025, endYear: 2030 } })
  for (const person of [people[0], people[2], people[3], people[4]]) await db.mandate.create({ data: {
    tenantId: tenant.id, legislatureId: legislature.id, parliamentarianId: person.id,
    startDate: new Date('2025-01-01T00:00:00Z'),
  } })
  await db.leave.create({ data: { tenantId: tenant.id, parliamentarianId: people[0].id,
    substituteId: people[1].id, kind: 'licenca', startDate: new Date('2025-01-01T00:00:00Z'),
    reason: 'Licença fictícia' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date('2026-11-05T15:00:00Z'), status: 'open', agendaPublished: true } })
  for (const person of people.slice(1)) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })

  // Os dois casos têm os MESMOS votos. Só a política de impedimento muda a
  // base: quatro cadeiras conservadas exigem 3 sim; três exigem 2 sim.
  for (const scenario of [
    { policy: 'retain_base', seats: 4, expected: 'rejeitado' },
    { policy: 'reduce_base', seats: 3, expected: 'aprovado' },
  ] as const) {
    await db.tenant.update({ where: { id: tenant.id }, data: { settings: JSON.stringify({
      quorumMinimum: 2, deliberativeRosterPolicy: 'mandate_and_leave',
      votingImpedimentPolicy: scenario.policy,
    }) } })
    const voting = await db.voting.create({ data: { sessionId: session.id,
      question: `Maioria absoluta ${scenario.policy}`, mode: 'nominal', status: 'ready',
      rule: 'maioria_absoluta', requiredQuorum: 2 } })
    const imp = await changeImpediment(post(voting.id, 'impediments', admin.id, {
      action: 'register', version: 1, parliamentarianId: people[4].id,
      reason: 'Impedimento fictício declarado pela Mesa',
    }), ctx(voting.id))
    expect(imp.status).toBe(200)
    expect((await act(voting.id, admin.id, { action: 'open', version: 2 })).status).toBe(200)
    const opened = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
    expect(opened).toMatchObject({ memberBaseAtOpen: scenario.seats, presentAtOpen: 3,
      quorumAtOpen: 2, impedimentPolicyAtOpen: scenario.policy })
    expect(new Set(JSON.parse(opened.eligibleVoterIdsAtOpen ?? '[]'))).toEqual(new Set(
      [people[1].id, people[2].id, people[3].id]))
    expect((await castVote(post(voting.id, 'votes', operator.id, { parliamentarianId: people[0].id,
      value: 'sim', commandId: crypto.randomUUID() }), ctx(voting.id))).status).toBe(409)
    expect((await castVote(post(voting.id, 'votes', operator.id, { parliamentarianId: people[4].id,
      value: 'sim', commandId: crypto.randomUUID() }), ctx(voting.id))).status).toBe(409)
    for (const [person, value] of [[people[1], 'sim'], [people[2], 'sim'], [people[3], 'nao']] as const) {
      expect((await castVote(post(voting.id, 'votes', operator.id, {
        parliamentarianId: person.id, value, commandId: crypto.randomUUID(),
      }), ctx(voting.id))).status).toBe(200)
    }
    expect((await act(voting.id, admin.id, { action: 'close', version: opened.version })).status).toBe(200)
    const paper = paperResult(['sim', 'sim', 'nao'], 3, scenario.seats, 2, 'maioria_absoluta')
    expect(paper.resultStatus).toBe(scenario.expected)
    const closed = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
    expect(closed.resultStatus).toBe(paper.resultStatus)
    expect(JSON.parse(closed.resultCounts ?? '{}')).toEqual(paper.counts)
    const report = await ataReport(new NextRequest(`http://localhost/api/v1/reports/session/${session.id}/ata`, {
      headers: { 'x-actor-id': admin.id },
    }), ctx(session.id))
    expect(report.status).toBe(200)
    const row = (await report.json()).ata.votings.find((item: { id: string }) => item.id === voting.id)
    expect(row).toMatchObject({ result: paper.resultStatus, counts: paper.counts })
  }
  const publicResponse = await publicSession(new NextRequest(
    `http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx(session.id))
  expect(publicResponse.status).toBe(200)
  expect((await publicResponse.json()).votings.map((v: { resultStatus: string }) => v.resultStatus))
    .toEqual(['rejeitado', 'aprovado'])
})

test('livro de papel: empate simbólico confirmado, anulação e isolamento entre Câmaras', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `paper-b-${suffix}`,
    name: 'Câmara Fictícia B', city: 'Teste', uf: 'BA', settings: JSON.stringify({ quorumMinimum: 2 }) } })
  const other = await db.tenant.create({ data: { slug: `paper-other-${suffix}`,
    name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const clerk = await db.user.create({ data: { tenantId: tenant.id, name: 'Secretaria B',
    email: `paper-clerk-${suffix}@example.invalid`, role: 'session_operator' } })
  const chair = await db.user.create({ data: { tenantId: tenant.id, name: 'Presidência B',
    email: `paper-chair-${suffix}@example.invalid`, role: 'presiding_officer' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Operador externo',
    email: `paper-out-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const people: Parliamentarian[] = []
  for (let i = 0; i < 4; i++) people.push(await db.parliamentarian.create({ data: {
    tenantId: tenant.id, name: `Vereador B${i}`, party: 'SEM', order: i,
  } }))
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1,
    year: 2026, scheduledAt: new Date('2026-11-05T16:00:00Z'), status: 'open',
    official: true, agendaPublished: true } })
  for (const person of people) await db.attendanceEvent.create({ data: { sessionId: session.id,
    parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador' } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Empate simbólico',
    mode: 'simbolico', status: 'open', rule: 'maioria_simples', requiredQuorum: 2,
    quorumAtOpen: 2, memberBaseAtOpen: 4, presentAtOpen: 4,
    eligibleVoterIdsAtOpen: JSON.stringify(people.map((person) => person.id)), version: 2 } })
  expect((await symbolicTally(post(voting.id, 'symbolic-tally', outsider.id, {
    action: 'propose', version: 2, sim: 2, nao: 2, abstencoes: 0,
  }), ctx(voting.id))).status).toBe(403)
  expect((await act(voting.id, outsider.id, { action: 'close', version: 2 })).status).toBe(403)
  expect((await act(voting.id, clerk.id, { action: 'close', version: 2 })).status).toBe(409)
  const proposed = await symbolicTally(post(voting.id, 'symbolic-tally', clerk.id, {
    action: 'propose', version: 2, sim: 2, nao: 2, abstencoes: 0,
  }), ctx(voting.id))
  expect(proposed.status).toBe(200)
  const revision = (await proposed.json()).revision
  expect((await symbolicTally(post(voting.id, 'symbolic-tally', clerk.id, {
    action: 'confirm', version: 3, revisionId: revision.id,
  }), ctx(voting.id))).status).toBe(403)
  expect((await symbolicTally(post(voting.id, 'symbolic-tally', chair.id, {
    action: 'confirm', version: 3, revisionId: revision.id,
  }), ctx(voting.id))).status).toBe(200)
  expect((await act(voting.id, clerk.id, { action: 'close', version: 4 })).status).toBe(200)
  const paper = paperResult(['sim', 'sim', 'nao', 'nao'], 4, 4, 2, 'maioria_simples')
  expect(paper.resultStatus).toBe('empate')
  const closed = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(closed.resultStatus).toBe(paper.resultStatus)
  expect(JSON.parse(closed.resultCounts ?? '{}')).toEqual(paper.counts)
  const before = await publicSession(new NextRequest(
    `http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx(session.id))
  expect((await before.json()).votings[0]).toMatchObject({ resultStatus: 'empate', resultCounts: paper.counts })
  const ataBefore = await ataReport(new NextRequest(`http://localhost/api/v1/reports/session/${session.id}/ata`, {
    headers: { 'x-actor-id': clerk.id },
  }), ctx(session.id))
  expect((await ataBefore.json()).ata.votings[0]).toMatchObject({ result: 'empate', counts: paper.counts })
  const wrongTenant = await publicSession(new NextRequest(
    `http://localhost/api/v1/public/sessions/${session.id}?tenant=${other.slug}`), ctx(session.id))
  expect(wrongTenant.status).toBe(404)

  expect((await act(voting.id, chair.id, { action: 'annul', version: closed.version,
    justification: 'Anulação fictícia registrada pela Mesa' })).status).toBe(200)
  const annulled = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(annulled).toMatchObject({ status: 'annulled', resultStatus: 'anulado',
    resultCounts: null, resultDetail: null })
  const audit = await db.auditEvent.findFirstOrThrow({ where: { tenantId: tenant.id,
    aggregateId: voting.id, action: 'voting.annulled' } })
  expect(JSON.parse(audit.beforeValue ?? '{}').resultCounts).toEqual(paper.counts)
  expect(await db.auditEvent.count({ where: { tenantId: other.id, aggregateId: voting.id } })).toBe(0)
  const after = await publicSession(new NextRequest(
    `http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx(session.id))
  expect((await after.json()).votings[0]).toMatchObject({ resultStatus: 'anulado', resultCounts: null })
  const ata = await ataReport(new NextRequest(`http://localhost/api/v1/reports/session/${session.id}/ata`, {
    headers: { 'x-actor-id': clerk.id },
  }), ctx(session.id))
  expect((await ata.json()).ata.votings[0]).toMatchObject({ result: 'anulado', counts: null })
})

test('livro de papel: saída após abertura muda presença, mantém base e produz empate nominal', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `paper-presence-${suffix}`,
    name: 'Câmara Fictícia de Presença', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2 }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Mesa',
    email: `paper-presence-admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador',
    email: `paper-presence-op-${suffix}@example.invalid`, role: 'session_operator' } })
  const people: Parliamentarian[] = []
  for (let i = 0; i < 4; i++) people.push(await db.parliamentarian.create({ data: {
    tenantId: tenant.id, name: `Parlamentar ${i}`, party: 'SEM', order: i,
  } }))
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1,
    year: 2026, scheduledAt: new Date('2026-11-05T17:00:00Z'), status: 'open',
    agendaPublished: true } })
  for (const person of people) await db.attendanceEvent.create({ data: { sessionId: session.id,
    parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador' } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Empate nominal',
    mode: 'nominal', status: 'ready', rule: 'maioria_simples', requiredQuorum: 2 } })
  expect((await act(voting.id, admin.id, { action: 'open', version: 1 })).status).toBe(200)
  const opened = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(opened).toMatchObject({ memberBaseAtOpen: 4, presentAtOpen: 4, quorumAtOpen: 2 })
  const checkout = await attendancePost(new NextRequest(
    `http://localhost/api/v1/sessions/${session.id}/attendance`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': admin.id },
      body: JSON.stringify({ parliamentarianId: people[3].id, action: 'check_out',
        commandId: crypto.randomUUID() }),
    }), ctx(session.id))
  expect(checkout.status).toBe(200)
  expect((await castVote(post(voting.id, 'votes', operator.id, {
    parliamentarianId: people[3].id, value: 'sim', commandId: crypto.randomUUID(),
  }), ctx(voting.id))).status).toBe(409)
  for (const [person, value] of [[people[0], 'sim'], [people[1], 'nao']] as const) {
    expect((await castVote(post(voting.id, 'votes', operator.id, {
      parliamentarianId: person.id, value, commandId: crypto.randomUUID(),
    }), ctx(voting.id))).status).toBe(200)
  }
  expect((await act(voting.id, admin.id, { action: 'close', version: opened.version })).status).toBe(200)
  const paper = paperResult(['sim', 'nao'], 3, 4, 2, 'maioria_simples')
  expect(paper).toMatchObject({ resultStatus: 'empate', counts: { naoRegistraram: 1 } })
  const closed = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(closed).toMatchObject({ memberBaseAtOpen: 4, presentAtClose: 3, resultStatus: 'empate' })
  expect(JSON.parse(closed.resultCounts ?? '{}')).toEqual(paper.counts)
  const nominal = JSON.parse(closed.resultDetail ?? '[]') as Array<{ name: string; value: string }>
  expect(nominal).toHaveLength(3)
  expect(nominal).toContainEqual(expect.objectContaining({ name: people[2].name, value: 'nao_registrado' }))
  const ata = await ataReport(new NextRequest(`http://localhost/api/v1/reports/session/${session.id}/ata`, {
    headers: { 'x-actor-id': admin.id },
  }), ctx(session.id))
  expect((await ata.json()).ata.votings[0]).toMatchObject({ result: paper.resultStatus, counts: paper.counts })
  const publicView = await publicSession(new NextRequest(
    `http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx(session.id))
  expect((await publicView.json()).votings[0]).toMatchObject({ resultStatus: paper.resultStatus,
    resultCounts: paper.counts })
})
