import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as votingTransition } from '@/app/api/v1/votings/[id]/transition/route'
import { GET as publicSessionGet } from '@/app/api/v1/public/sessions/[id]/route'
import { GET as publicMatterGet } from '@/app/api/v1/public/matters/[id]/route'
import { GET as publicLiveGet } from '@/app/api/v1/public/live/route'
import { GET as openDataGet } from '@/app/api/v1/public/open-data/route'
import { GET as ataGet } from '@/app/api/v1/reports/session/[id]/ata/route'

afterAll(async () => { await db.$disconnect() })

async function fixture() {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `annul-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 1 }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin',
    email: `annul-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const person = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereadora', party: 'SEM' } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei',
    number: 1, year: 2026, ementa: 'Teste', authors: '[]', status: 'aprovado' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    status: 'closed', agendaPublished: true, scheduledAt: new Date(), openedAt: new Date(), closedAt: new Date() } })
  const item = await db.agendaItem.create({ data: { sessionId: session.id, order: 0, title: 'Projeto em votação',
    matterId: matter.id, status: 'aprovado', resultSummary: 'Aprovado por 1 voto' } })
  const counts = { sim: 1, nao: 0, abstencoes: 0, naoRegistraram: 0, presentes: 1 }
  const voting = await db.voting.create({ data: { sessionId: session.id, agendaItemId: item.id, matterId: matter.id,
    question: item.title, status: 'closed', mode: 'nominal', rule: 'maioria_simples', resultStatus: 'aprovado',
    resultCounts: JSON.stringify(counts), resultDetail: JSON.stringify([{ parliamentarianId: person.id,
      name: person.name, value: 'sim' }]), closedAt: new Date(), presentAtOpen: 1, presentAtClose: 1,
    quorumAtOpen: 1, memberBaseAtOpen: 1 } })
  return { tenant, admin, person, matter, session, item, voting, counts }
}

function annul(id: string, actorId: string, version = 1) {
  return votingTransition(new NextRequest(`http://localhost/api/v1/votings/${id}/transition`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify({ action: 'annul', version, justification: 'Erro material registrado pela Mesa' }),
  }), { params: Promise.resolve({ id }) })
}

test('anulação antiga não sobrescreve deliberação posterior; mudança processual também bloqueia', async () => {
  const f = await fixture()
  const newer = await db.voting.create({ data: { sessionId: f.session.id, agendaItemId: f.item.id,
    matterId: f.matter.id, question: 'Nova deliberação', status: 'closed', mode: 'nominal',
    resultStatus: 'aprovado', closedAt: new Date(Date.now() + 1000),
    createdAt: new Date(f.voting.createdAt.getTime() + 1000) } })
  expect((await annul(f.voting.id, f.admin.id)).status).toBe(409)
  expect((await db.legislativeMatter.findUniqueOrThrow({ where: { id: f.matter.id } })).status).toBe('aprovado')
  expect((await annul(newer.id, f.admin.id)).status).toBe(200)
  expect((await annul(f.voting.id, f.admin.id)).status).toBe(409)

  const another = await fixture()
  await db.legislativeMatter.update({ where: { id: another.matter.id }, data: { status: 'sancionado' } })
  expect((await annul(another.voting.id, another.admin.id)).status).toBe(409)
  expect((await db.voting.findUniqueOrThrow({ where: { id: another.voting.id } })).status).toBe('closed')
})

test('anulação aparece em ata, dados públicos e telão; transmissão permanece intacta', async () => {
  const f = await fixture()
  await db.transmission.create({ data: { tenantId: f.tenant.id, sessionId: f.session.id, status: 'monitoring' } })
  expect((await annul(f.voting.id, f.admin.id)).status).toBe(200)
  const row = await db.voting.findUniqueOrThrow({ where: { id: f.voting.id } })
  expect(row).toMatchObject({ status: 'annulled', resultStatus: 'anulado', resultCounts: null, resultDetail: null })
  expect((await db.legislativeMatter.findUniqueOrThrow({ where: { id: f.matter.id } })).status).toBe('incluida_pauta')
  expect((await db.agendaItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe('em_discussao')
  expect((await db.transmission.findUniqueOrThrow({ where: { sessionId: f.session.id } })).status).toBe('monitoring')
  const audit = await db.auditEvent.findFirstOrThrow({ where: { tenantId: f.tenant.id, action: 'voting.annulled' } })
  expect(JSON.parse(audit.beforeValue ?? '{}').resultCounts).toMatchObject(f.counts)

  const publicSession = await publicSessionGet(new NextRequest(`http://localhost/api/v1/public/sessions/${f.session.id}?tenant=${f.tenant.slug}`),
    { params: Promise.resolve({ id: f.session.id }) })
  const publicBody = await publicSession.json()
  expect(publicBody.votings[0]).toMatchObject({ status: 'annulled', resultStatus: 'anulado',
    resultCounts: null, nominalDetail: null })
  const publicMatter = await publicMatterGet(new NextRequest(`http://localhost/api/v1/public/matters/${f.matter.id}?tenant=${f.tenant.slug}`),
    { params: Promise.resolve({ id: f.matter.id }) })
  expect((await publicMatter.json()).lastVoting).toMatchObject({ resultStatus: 'anulado',
    resultCounts: null, nominalDetail: null })
  const openData = await openDataGet(new NextRequest(`http://localhost/api/v1/public/open-data?tenant=${f.tenant.slug}&dataset=votes`),
    { params: Promise.resolve({}) })
  expect((await openData.json()).votes[0]).toMatchObject({ status: 'annulled', resultStatus: 'anulado',
    counts: null, nominalDetail: null })
  const csv = await openDataGet(new NextRequest(`http://localhost/api/v1/public/open-data?tenant=${f.tenant.slug}&dataset=votes&format=csv`),
    { params: Promise.resolve({}) })
  expect(await csv.text()).toContain('VOTAÇÃO ANULADA')
  const sessionsCsv = await openDataGet(new NextRequest(`http://localhost/api/v1/public/open-data?tenant=${f.tenant.slug}&dataset=sessions&format=csv`),
    { params: Promise.resolve({}) })
  expect(await sessionsCsv.text()).toContain('votacoesAnuladas')
  const live = await publicLiveGet(new NextRequest(`http://localhost/api/v1/public/live?tenant=${f.tenant.slug}`),
    { params: Promise.resolve({}) })
  expect((await live.json()).lastResults[0]).toMatchObject({ resultStatus: 'anulado',
    resultCounts: null, nominalDetail: null })
  const ata = await ataGet(new NextRequest(`http://localhost/api/v1/reports/session/${f.session.id}/ata`, {
    headers: { 'x-actor-id': f.admin.id },
  }), { params: Promise.resolve({ id: f.session.id }) })
  expect((await ata.json()).ata.votings[0]).toMatchObject({ result: 'anulado', counts: null, nominal: null })
})
