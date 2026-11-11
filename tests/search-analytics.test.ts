import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as search } from '@/app/api/v1/search/route'
import { GET as analytics } from '@/app/api/v1/analytics/overview/route'

afterAll(async () => { await db.$disconnect() })

const get = (url: string, actorId: string) => new NextRequest(url, {
  method: 'GET', headers: { 'x-actor-id': actorId },
})

test('busca unificada e analytics respeitam tenant, janela anual, agregações e RBAC', async () => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
  const year = new Date().getUTCFullYear()
  const tenant = await db.tenant.create({ data: {
    slug: `search-analytics-${suffix}`, name: 'Câmara da Busca', city: 'Teste', uf: 'BA',
  } })
  const otherTenant = await db.tenant.create({ data: {
    slug: `search-analytics-out-${suffix}`, name: 'Câmara Vizinha', city: 'Teste', uf: 'BA',
  } })
  const admin = await db.user.create({ data: {
    tenantId: tenant.id, name: 'Admin de Leitura', email: `sa-admin-${suffix}@example.invalid`, role: 'tenant_admin',
  } })
  const media = await db.user.create({ data: {
    tenantId: tenant.id, name: 'Operador de Mídia', email: `sa-media-${suffix}@example.invalid`, role: 'media_operator',
  } })
  const neighbor = await db.user.create({ data: {
    tenantId: otherTenant.id, name: 'Admin da Câmara Vizinha', email: `sa-neighbor-${suffix}@example.invalid`, role: 'tenant_admin',
  } })
  const global = await db.user.create({ data: {
    name: 'Dona da Plataforma', email: `sa-owner-${suffix}@example.invalid`, role: 'platform_owner',
  } })

  const members = await Promise.all([
    db.parliamentarian.create({ data: { tenantId: tenant.id, name: `Ana Busca ${suffix}`, party: 'AA', order: 0 } }),
    db.parliamentarian.create({ data: { tenantId: tenant.id, name: `Bia Busca ${suffix}`, party: 'AA', order: 1 } }),
    db.parliamentarian.create({ data: { tenantId: tenant.id, name: `Caio Busca ${suffix}`, party: 'BB', order: 2 } }),
  ])
  const matters = await Promise.all(Array.from({ length: 6 }, (_, index) => db.legislativeMatter.create({ data: {
    tenantId: tenant.id, type: 'projeto_de_lei', number: index + 1, year,
    ementa: `BuscaIntegrada${suffix} matéria de teste ${index + 1}`,
    authors: JSON.stringify([`Autoria Busca ${suffix}`]), status: index === 0 ? 'aprovado' : 'em_tramitacao',
  } })))
  const foreignMatter = await db.legislativeMatter.create({ data: {
    tenantId: otherTenant.id, type: 'projeto_de_lei', number: 1, year,
    ementa: `BuscaIntegrada${suffix} dado privado vizinho`, authors: '[]',
  } })
  const publication = await db.publication.create({ data: {
    tenantId: tenant.id, number: 1, year, kind: 'decreto',
    title: `BuscaIntegrada${suffix} publicação sintética`, status: 'published',
  } })

  const heldAt = new Date(Date.UTC(year, 1, 10, 18))
  const held = await db.session.create({ data: {
    tenantId: tenant.id, number: 41, year, type: 'ordinaria', scheduledAt: heldAt,
    status: 'closed', presidentId: members[0].id, presidentName: members[0].name, location: 'Plenário de teste',
  } })
  await db.session.create({ data: {
    tenantId: tenant.id, number: 42, year, type: 'extraordinaria',
    scheduledAt: new Date(Date.UTC(year, 2, 10, 18)), status: 'scheduled',
  } })
  await db.attendanceEvent.createMany({ data: [
    { sessionId: held.id, parliamentarianId: members[0].id, kind: 'check_in', status: 'presente', createdAt: new Date(heldAt.getTime() - 60_000) },
    { sessionId: held.id, parliamentarianId: members[1].id, kind: 'check_in', status: 'presente', createdAt: new Date(heldAt.getTime() - 50_000) },
    { sessionId: held.id, parliamentarianId: members[1].id, kind: 'check_out', status: 'ausente', createdAt: new Date(heldAt.getTime() - 40_000) },
  ] })

  const nominal = await db.voting.create({ data: {
    sessionId: held.id, question: `Votação Analytics ${suffix}`, mode: 'nominal', status: 'closed',
    resultStatus: 'aprovado', resultCounts: JSON.stringify({ sim: 3, nao: 0, abstencoes: 0 }),
  } })
  const secret = await db.voting.create({ data: {
    sessionId: held.id, question: `Votação sigilosa excluída ${suffix}`, mode: 'secreto', status: 'closed',
    resultStatus: 'rejeitado',
  } })
  const annulled = await db.voting.create({ data: {
    sessionId: held.id, question: `Votação anulada ${suffix}`, mode: 'nominal', status: 'annulled', resultStatus: 'anulado',
  } })
  await db.vote.createMany({ data: [
    { votingId: nominal.id, parliamentarianId: members[0].id, value: 'sim', commandId: crypto.randomUUID() },
    { votingId: nominal.id, parliamentarianId: members[1].id, value: 'nao', commandId: crypto.randomUUID() },
    { votingId: nominal.id, parliamentarianId: members[2].id, value: 'sim', commandId: crypto.randomUUID() },
    { votingId: secret.id, parliamentarianId: members[0].id, value: 'nao', commandId: crypto.randomUUID() },
    { votingId: annulled.id, parliamentarianId: members[0].id, value: 'sim', commandId: crypto.randomUUID() },
  ] })
  await db.proceeding.createMany({ data: [
    { matterId: matters[0].id, seq: 1, action: 'despacho', fromStatus: 'em_tramitacao', toStatus: 'em_tramitacao', actorName: 'Secretaria', actorRole: 'legislative_admin', createdAt: new Date(Date.UTC(year, 0, 10)) },
    { matterId: matters[0].id, seq: 2, action: 'inclusao_pauta', fromStatus: 'em_tramitacao', toStatus: 'incluida_pauta', actorName: 'Secretaria', actorRole: 'legislative_admin', createdAt: new Date(Date.UTC(year, 0, 20)) },
  ] })

  const searchResponse = await search(get(`http://localhost/api/v1/search?q=BuscaIntegrada${suffix}`, admin.id), { params: Promise.resolve({}) })
  expect(searchResponse.status).toBe(200)
  const searchBody = await searchResponse.json()
  expect(searchBody.query).toBe(`BuscaIntegrada${suffix}`)
  expect(searchBody.sections.map((section: { id: string }) => section.id)).toEqual(['matters', 'sessions', 'parliamentarians', 'publications'])
  const matterItems = searchBody.sections.find((section: { id: string }) => section.id === 'matters').items
  expect(matterItems.length).toBe(5)
  expect(matterItems.some((item: { id: string }) => item.id === foreignMatter.id)).toBe(false)
  const publications = await search(get(`http://localhost/api/v1/search?q=BuscaIntegrada${suffix}`, admin.id), { params: Promise.resolve({}) })
  expect((await publications.json()).sections[3].items[0].id).toBe(publication.id)
  const mediaSearch = await search(get(`http://localhost/api/v1/search?q=BuscaIntegrada${suffix}`, media.id), { params: Promise.resolve({}) })
  expect((await mediaSearch.json()).sections[0].items.length).toBe(5)
  const numericSearch = await search(get(`http://localhost/api/v1/search?q=${year}`, admin.id), { params: Promise.resolve({}) })
  expect((await numericSearch.json()).sections.find((section: { id: string }) => section.id === 'sessions').items.length).toBe(2)
  const emptySearch = await search(get(`http://localhost/api/v1/search?q=NenhumResultado${suffix}`, admin.id), { params: Promise.resolve({}) })
  expect((await emptySearch.json()).sections.every((section: { items: unknown[] }) => section.items.length === 0)).toBe(true)
  expect((await search(get('http://localhost/api/v1/search?q=x', admin.id), { params: Promise.resolve({}) })).status).toBe(422)
  const isolatedSearch = await search(get(`http://localhost/api/v1/search?q=BuscaIntegrada${suffix}`, neighbor.id), { params: Promise.resolve({}) })
  expect((await isolatedSearch.json()).sections[0].items.map((item: { id: string }) => item.id)).toEqual([foreignMatter.id])

  const analyticsResponse = await analytics(get(`http://localhost/api/v1/analytics/overview?year=${year}`, admin.id), { params: Promise.resolve({}) })
  expect(analyticsResponse.status).toBe(200)
  const overview = await analyticsResponse.json()
  expect(overview.kpis).toMatchObject({ sessionsHeld: 1, avgAttendancePct: 33.3, totalMatters: 6, approvedMatters: 1, votingApprovalPct: 50, avgProceedingDays: 10 })
  expect(overview.sessionsByMonth.reduce((sum: number, month: { scheduled: number }) => sum + month.scheduled, 0)).toBe(2)
  expect(overview.attendanceRanking.find((row: { parliamentarianId: string }) => row.parliamentarianId === members[1].id)).toMatchObject({ present: 0, pct: 0 })
  expect(overview.topAuthors.find((row: { name: string }) => row.name === `Autoria Busca ${suffix}`).count).toBe(6)
  expect(overview.votingResults).toMatchObject({ approved: 1, rejected: 1, annulled: 1, total: 3 })
  expect(overview.partyDiscipline).toContainEqual({ party: 'AA', cohesionPct: 0, votesAnalyzed: 2, votingsCount: 1 })
  expect(overview.partyDiscipline.find((row: { party: string }) => row.party === 'BB')).toMatchObject({ cohesionPct: 100, votesAnalyzed: 1 })
  expect(overview.proceedingsFlow.avgTotalDays).toBe(10)
  expect(overview.proceedingsFlow.items).toContainEqual(expect.objectContaining({ action: 'inclusao_pauta', count: 1, avgDaysFromPrevious: 10 }))
  expect((await analytics(get(`http://localhost/api/v1/analytics/overview?year=1999`, admin.id), { params: Promise.resolve({}) })).status).toBe(422)
  expect((await analytics(get(`http://localhost/api/v1/analytics/overview?year=${year}`, media.id), { params: Promise.resolve({}) })).status).toBe(403)
  const emptyOverview = await analytics(get('http://localhost/api/v1/analytics/overview?year=2000', admin.id), { params: Promise.resolve({}) })
  expect((await emptyOverview.json()).kpis).toMatchObject({ sessionsHeld: 0, avgAttendancePct: null, totalMatters: 0, approvedMatters: 0, votingApprovalPct: null, avgProceedingDays: null })
  const platformOverview = await analytics(get(`http://localhost/api/v1/analytics/overview?tenant=${otherTenant.slug}&year=${year}`, global.id), { params: Promise.resolve({}) })
  expect(platformOverview.status).toBe(200)
  expect((await platformOverview.json()).kpis.totalMatters).toBe(1)
})
