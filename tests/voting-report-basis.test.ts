import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as reportGet } from '@/app/api/v1/reports/session/[id]/route'
import { GET as ataGet } from '@/app/api/v1/reports/session/[id]/ata/route'
import { GET as publicSessionGet } from '@/app/api/v1/public/sessions/[id]/route'
import { GET as openDataGet } from '@/app/api/v1/public/open-data/route'
import { buildTenantExport } from '@/lib/server/tenant-export'

afterAll(async () => { await db.$disconnect() })

test('espelho e ata mostram base e motivo por permissão; saídas públicas preservam sigilo', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `report-imp-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const reader = await db.user.create({ data: { tenantId: tenant.id, name: 'Leitor', email: `reader-${suffix}@example.invalid`, role: 'parliamentarian' } })
  const person = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereadora Impedida', party: 'SEM' } })
  const voter = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereador Votante', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    status: 'closed', scheduledAt: new Date(), openedAt: new Date(), closedAt: new Date(), agendaPublished: true } })
  const counts = JSON.stringify({ sim: 1, nao: 0, abstencoes: 0, naoRegistraram: 0, presentes: 1 })
  const nominal = await db.voting.create({ data: { sessionId: session.id, question: 'Votação nominal',
    status: 'closed', mode: 'nominal', rule: 'maioria_absoluta', resultStatus: 'rejeitado',
    resultCounts: counts, presentAtOpen: 1, presentAtClose: 1, quorumAtOpen: 1, memberBaseAtOpen: 3,
    impedimentPolicyAtOpen: 'retain_base', closedAt: new Date(),
    resultDetail: JSON.stringify([{ parliamentarianId: voter.id, name: voter.name, value: 'sim' }]),
  } })
  const secret = await db.voting.create({ data: { sessionId: session.id, question: 'Votação secreta',
    status: 'closed', mode: 'secreto', rule: 'maioria_simples', resultStatus: 'aprovado',
    resultCounts: counts, presentAtOpen: 1, presentAtClose: 1, quorumAtOpen: 1, memberBaseAtOpen: 2,
    impedimentPolicyAtOpen: 'reduce_base', closedAt: new Date(),
    resultDetail: JSON.stringify([{ parliamentarianId: voter.id, name: voter.name, value: 'sim' }]),
  } })
  for (const voting of [nominal, secret]) await db.votingImpediment.create({ data: {
    votingId: voting.id, parliamentarianId: person.id, actorId: admin.id,
    reason: 'Motivo reservado para o relatório interno',
  } })
  await db.vote.create({ data: { votingId: secret.id, parliamentarianId: voter.id, value: 'sim',
    commandId: crypto.randomUUID() } })

  const ctx = { params: Promise.resolve({ id: session.id }) }
  const report = async (actorId: string) => (await reportGet(new NextRequest(`http://localhost/api/v1/reports/session/${session.id}`, {
    headers: { 'x-actor-id': actorId },
  }), ctx)).json()
  const ata = async (actorId: string) => (await ataGet(new NextRequest(`http://localhost/api/v1/reports/session/${session.id}/ata`, {
    headers: { 'x-actor-id': actorId },
  }), ctx)).json()
  const adminReport = await report(admin.id)
  const readerReport = await report(reader.id)
  expect(adminReport.votingBases[nominal.id]).toMatchObject({ memberBaseAtOpen: 3,
    impedimentPolicyAtOpen: 'retain_base', impediments: [{ reason: 'Motivo reservado para o relatório interno' }] })
  expect(readerReport.votingBases[nominal.id].impediments[0].reason).toBeNull()
  expect((await ata(admin.id)).ata.votings[0].basis.impediments[0].reason).toBe('Motivo reservado para o relatório interno')
  expect((await ata(reader.id)).ata.votings[0].basis.impediments[0].reason).toBeNull()
  expect((await ata(admin.id)).ata.votings[1].nominal).toBeNull()

  const publicSession = await publicSessionGet(new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx)
  const publicBody = await publicSession.json()
  expect(publicBody.votings[0].votingBasis).toMatchObject({ memberBaseAtOpen: 3, impedimentCount: 1 })
  expect(publicBody.votings[1].nominalDetail).toBeNull()
  expect(JSON.stringify(publicBody)).not.toContain('Motivo reservado')
  const openData = await openDataGet(new NextRequest(`http://localhost/api/v1/public/open-data?tenant=${tenant.slug}&dataset=votes`),
    { params: Promise.resolve({}) })
  const dataBody = await openData.json()
  expect(dataBody.votes[0].votingBasis.impedimentCount).toBe(1)
  expect(JSON.stringify(dataBody)).not.toContain('Motivo reservado')
  const csv = await openDataGet(new NextRequest(`http://localhost/api/v1/public/open-data?tenant=${tenant.slug}&dataset=votes&format=csv`),
    { params: Promise.resolve({}) })
  const csvText = await csv.text()
  expect(csvText).toContain('baseMaioriaAbsoluta')
  expect(csvText).not.toContain('Motivo reservado')
  expect(csvText).toContain('VOTAÇÃO SECRETA')

  const exportPayload = await buildTenantExport(tenant.id)
  expect(exportPayload.counts.votingImpediments).toBe(2)
  const exportedSessions = exportPayload.data.sessions as Array<{ votings: Array<{ impediments: Array<{ reason: string }>;
    votes: Array<{ value: string | null }>; resultDetail: string | null }> }>
  expect(exportedSessions[0].votings[0].impediments[0].reason).toBe('Motivo reservado para o relatório interno')
  expect(exportedSessions[0].votings[1].votes[0].value).toBeNull()
  expect(exportedSessions[0].votings[1].resultDetail).toBeNull()
})
