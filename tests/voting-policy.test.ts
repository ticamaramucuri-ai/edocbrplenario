import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createVoting } from '@/app/api/v1/sessions/[id]/votings/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'
import { GET as publicSession } from '@/app/api/v1/public/sessions/[id]/route'
import { PATCH as updateTenant } from '@/app/api/v1/tenants/[id]/route'
import { computeVotingResult } from '@/lib/server/domain'
import { computeVotingResultAdvanced } from '@/lib/server/voting-service'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, actorId: string, body: unknown) => new NextRequest(url, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })

test('política por matéria congela regra/quórum e usa base de membros na maioria absoluta', async () => {
  const tenant = await db.tenant.create({ data: { slug: 'voting-policy-a', name: 'Câmara Votação', city: 'Cidade', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2, votingPoliciesByMatterType: {
      projeto_de_lei: { rule: 'maioria_absoluta', quorumMinimum: 3 },
    } }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: 'voting-policy@example.invalid', role: 'tenant_admin' } })
  const updated = await updateTenant(new NextRequest(`http://localhost/api/v1/tenants/${tenant.id}`, { method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-actor-id': admin.id },
    body: JSON.stringify({ settings: { votingPoliciesByMatterType: { projeto_de_lei: { rule: 'maioria_absoluta', quorumMinimum: 3 } } } }) }),
  { params: Promise.resolve({ id: tenant.id }) })
  expect(updated.status).toBe(200)
  const people = await Promise.all(Array.from({ length: 5 }, (_, i) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name: `Vereador ${i + 1}`, party: 'SEM', order: i },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(Date.now() + 86400000), status: 'open', agendaPublished: true } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1,
    year: 2026, ementa: 'Projeto', authors: '[]' } })
  const item = await db.agendaItem.create({ data: { sessionId: session.id, order: 0, matterId: matter.id, title: 'Projeto' } })
  for (const person of people.slice(0, 2)) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const url = `http://localhost/api/v1/sessions/${session.id}/votings`
  const create = (rule?: string) => createVoting(request(url, admin.id, { agendaItemId: item.id, mode: 'simbolico', rule }),
    { params: Promise.resolve({ id: session.id }) })
  expect((await create('maioria_simples')).status).toBe(422)
  const created = await create()
  expect(created.status).toBe(201)
  const voting = (await created.json()).voting as { id: string; version: number; rule: string; requiredQuorum: number }
  expect(voting).toMatchObject({ rule: 'maioria_absoluta', requiredQuorum: 3 })
  const transition = (action: string, version: number, extra: object = {}) => transitionVoting(request(
    `http://localhost/api/v1/votings/${voting.id}/transition`, admin.id, { action, version, ...extra }),
    { params: Promise.resolve({ id: voting.id }) })
  expect((await transition('open', voting.version)).status).toBe(409)
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: people[2].id,
    kind: 'check_in', status: 'presente', source: 'operador' } })
  const opened = await transition('open', voting.version)
  expect(opened.status).toBe(200)
  const openVoting = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(openVoting).toMatchObject({ quorumAtOpen: 3, memberBaseAtOpen: 5 })
  // Mudar a política após abrir não altera o julgamento desta votação.
  await db.tenant.update({ where: { id: tenant.id }, data: { settings: JSON.stringify({ quorumMinimum: 5,
    votingPoliciesByMatterType: { projeto_de_lei: { rule: 'unanimidade', quorumMinimum: 5 } } }) } })
  expect((await transition('close', openVoting.version, { sim: 4, nao: 0, abstencoes: 0 })).status).toBe(422)
  const closed = await transition('close', openVoting.version, { sim: 2, nao: 0, abstencoes: 1 })
  expect(closed.status).toBe(200)
  expect(await db.voting.findUniqueOrThrow({ where: { id: voting.id } })).toMatchObject({
    rule: 'maioria_absoluta', quorumAtClose: 3, resultStatus: 'rejeitado',
  })
})

test('empate, abstenção e opções customizadas respeitam a base total', () => {
  expect(computeVotingResult({ rule: 'maioria_simples', countsSimbolico: { sim: 2, nao: 2, abstencoes: 1 },
    presentCount: 5, totalMembers: 5, requiredQuorum: 3 }).resultStatus).toBe('empate')
  expect(computeVotingResult({ rule: 'unanimidade', countsSimbolico: { sim: 4, nao: 0, abstencoes: 1 },
    presentCount: 5, totalMembers: 5, requiredQuorum: 3 }).resultStatus).toBe('rejeitado')
  const options = [{ key: 'a', label: 'A', order: 0 }, { key: 'b', label: 'B', order: 1 }]
  expect(computeVotingResultAdvanced({ rule: 'maioria_absoluta', options, customCounts: { a: 2, b: 1 },
    presentCount: 3, totalMembers: 5, requiredQuorum: 3 }).resultStatus).toBe('rejeitado')
  expect(computeVotingResultAdvanced({ rule: 'maioria_absoluta', options, customCounts: { a: 3, b: 0 },
    presentCount: 3, totalMembers: 5, requiredQuorum: 3 }).resultStatus).toBe('aprovado')
})

test('opções customizadas da votação validam limites, chaves duplicadas e rótulos antes de persistir', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `voting-options-${suffix}`, name: 'Câmara Opções', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `options-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(), status: 'open', agendaPublished: true } })
  const url = `http://localhost/api/v1/sessions/${session.id}/votings`
  const create = (options: unknown) => createVoting(request(url, admin.id, {
    question: `Deliberação ${suffix}`, mode: 'nominal', options,
  }), { params: Promise.resolve({ id: session.id }) })

  const valid = [
    { key: 'opcao_1', label: '  Uma  ' },
    { key: 'opcao_2', label: 'Duas' },
    { key: 'opcao_3', label: 'Três' },
    { key: 'opcao_4', label: 'Quatro' },
    { key: 'opcao_5', label: 'Cinco' },
  ]
  const accepted = await create(valid)
  expect(accepted.status).toBe(201)
  const acceptedVoting = (await accepted.json()).voting
  expect(acceptedVoting.options).toEqual(valid.map((option, order) => ({ ...option, label: option.label.trim(), order })))

  const invalid = [
    { name: 'mais de cinco opções', options: [...valid, { key: 'opcao_6', label: 'Seis' }] },
    { name: 'chaves duplicadas', options: [{ key: 'mesma', label: 'Uma' }, { key: 'mesma', label: 'Duas' }] },
    { name: 'chave fora do padrão', options: [{ key: 'Maiuscula', label: 'Uma' }] },
    { name: 'rótulo vazio', options: [{ key: 'vazio', label: '   ' }] },
    { name: 'rótulo acima de 60 caracteres', options: [{ key: 'extenso', label: 'x'.repeat(61) }] },
  ]
  for (const scenario of invalid) {
    const before = await db.voting.count({ where: { sessionId: session.id } })
    const rejected = await create(scenario.options)
    expect(rejected.status, scenario.name).toBe(422)
    expect(await db.voting.count({ where: { sessionId: session.id } }), `${scenario.name} não deve persistir votação`).toBe(before)
  }
})

test('apuração nominal persiste empate entre opções customizadas pela rota completa', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `voting-custom-tie-${suffix}`, name: 'Câmara Empate', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2 }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `tie-admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Mesa', email: `tie-operator-${suffix}@example.invalid`, role: 'session_operator' } })
  const people = await Promise.all(['Vereadora A', 'Vereador B'].map((name, order) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name, party: 'ENSAIO', order },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(), openedAt: new Date(), status: 'open', agendaPublished: true } })
  for (const person of people) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const sessionUrl = `http://localhost/api/v1/sessions/${session.id}/votings`
  const created = await createVoting(request(sessionUrl, admin.id, {
    question: `Empate customizado ${suffix}`, mode: 'nominal', rule: 'maioria_simples',
    options: [{ key: 'a_favor', label: 'A favor' }, { key: 'contra', label: 'Contra' }],
  }), { params: Promise.resolve({ id: session.id }) })
  expect(created.status).toBe(201)
  const voting = (await created.json()).voting as { id: string; version: number }
  const transition = (action: string, version: number) => transitionVoting(request(
    `http://localhost/api/v1/votings/${voting.id}/transition`, admin.id, { action, version }),
  { params: Promise.resolve({ id: voting.id }) })
  expect((await transition('open', voting.version)).status).toBe(200)

  const cast = (personId: string, value: string) => castVote(request(
    `http://localhost/api/v1/votings/${voting.id}/votes`, operator.id,
    { parliamentarianId: personId, value, commandId: crypto.randomUUID() }),
  { params: Promise.resolve({ id: voting.id }) })
  expect((await cast(people[0].id, 'a_favor')).status).toBe(200)
  expect((await cast(people[1].id, 'contra')).status).toBe(200)

  const current = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  const closed = await transition('close', current.version)
  expect(closed.status).toBe(200)
  const result = (await closed.json()).voting
  expect(result).toMatchObject({ status: 'closed', resultStatus: 'empate', registeredCount: 2, resultCounts: {
    custom: { a_favor: 1, contra: 1 }, naoRegistraram: 0, presentes: 2,
  } })
})

test('maioria nominal customizada é publicada com contagens na sessão pública', async () => {
  const suffix = crypto.randomUUID()
  const tenantSlug = `voting-custom-winner-${suffix}`
  const tenant = await db.tenant.create({ data: { slug: tenantSlug, name: 'Câmara Resultado', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 2 }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `winner-admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Mesa', email: `winner-operator-${suffix}@example.invalid`, role: 'session_operator' } })
  const people = await Promise.all(['Vereadora A', 'Vereador B', 'Vereadora C'].map((name, order) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name, party: 'ENSAIO', order },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(), openedAt: new Date(), status: 'open', agendaPublished: true } })
  for (const person of people) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: person.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const created = await createVoting(request(`http://localhost/api/v1/sessions/${session.id}/votings`, admin.id, {
    question: `Maioria customizada ${suffix}`, mode: 'nominal', rule: 'maioria_simples',
    options: [{ key: 'a_favor', label: 'A favor' }, { key: 'contra', label: 'Contra' }],
  }), { params: Promise.resolve({ id: session.id }) })
  expect(created.status).toBe(201)
  const voting = (await created.json()).voting as { id: string; version: number }
  const transition = (action: string, version: number) => transitionVoting(request(
    `http://localhost/api/v1/votings/${voting.id}/transition`, admin.id, { action, version }),
  { params: Promise.resolve({ id: voting.id }) })
  expect((await transition('open', voting.version)).status).toBe(200)
  for (const [index, value] of ['a_favor', 'a_favor', 'contra'].entries()) {
    const response = await castVote(request(`http://localhost/api/v1/votings/${voting.id}/votes`, operator.id, {
      parliamentarianId: people[index].id, value, commandId: crypto.randomUUID(),
    }), { params: Promise.resolve({ id: voting.id }) })
    expect(response.status).toBe(200)
  }
  const current = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  const closed = await transition('close', current.version)
  expect(closed.status).toBe(200)
  const privateResult = (await closed.json()).voting
  expect(privateResult).toMatchObject({ resultStatus: 'aprovado', registeredCount: 3,
    resultCounts: { custom: { a_favor: 2, contra: 1 }, naoRegistraram: 0, presentes: 3 } })

  const publicResponse = await publicSession(new NextRequest(
    `http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenantSlug}`),
  { params: Promise.resolve({ id: session.id }) })
  expect(publicResponse.status).toBe(200)
  const publicResult = (await publicResponse.json()).votings.find((item: { id: string }) => item.id === voting.id)
  expect(publicResult).toMatchObject({ resultStatus: 'aprovado', resultCounts: {
    custom: { a_favor: 2, contra: 1 }, naoRegistraram: 0, presentes: 3,
  } })
})
