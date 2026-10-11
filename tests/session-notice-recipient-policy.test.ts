import { afterAll, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import { eligibleNoticeRecipients, snapshotNoticeRecipients } from '@/lib/server/session-notice-recipients'
import { GET as preview } from '@/app/api/v1/sessions/[id]/notice-recipient-preview/route'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'

afterAll(async () => { await db.$disconnect() })

test('política por Câmara usa mandato no dia local, afasta titular e inclui suplente ativo', async () => {
  const tenant = await db.tenant.create({ data: { slug: 'recipients-policy-a', name: 'Câmara A', city: 'A', uf: 'BA', timezone: 'America/Sao_Paulo' } })
  const other = await db.tenant.create({ data: { slug: 'recipients-policy-b', name: 'Câmara B', city: 'B', uf: 'BA', settings: JSON.stringify({ noticeRecipientPolicy: 'mandate_and_leave' }) } })
  // 01h UTC ainda é dia 11 na Câmara; mandato iniciado no dia 12 não vale.
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026, scheduledAt: new Date('2026-10-12T01:00:00Z') } })
  const otherSession = await db.session.create({ data: { tenantId: other.id, number: 1, year: 2026, scheduledAt: new Date('2026-10-12T01:00:00Z') } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: 'recipient-policy-a@example.invalid', role: 'tenant_admin' } })
  const foreign = await db.user.create({ data: { tenantId: other.id, name: 'Outro', email: 'recipient-policy-b@example.invalid', role: 'tenant_admin' } })
  const legislature = await db.legislature.create({ data: { tenantId: tenant.id, number: 1, startYear: 2025, endYear: 2028 } })
  const titular = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Titular', party: 'SEM' } })
  const suplente = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Suplente', party: 'SEM' } })
  const future = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Mandato futuro', party: 'SEM' } })
  const inactive = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Inativo', party: 'SEM', active: false } })
  await db.parliamentarian.create({ data: { tenantId: other.id, name: 'Outra Câmara', party: 'SEM' } })
  const day10 = new Date('2026-10-10T00:00:00Z')
  const day12 = new Date('2026-10-12T00:00:00Z')
  for (const person of [titular, inactive]) await db.mandate.create({ data: { tenantId: tenant.id, legislatureId: legislature.id, parliamentarianId: person.id, startDate: day10 } })
  await db.mandate.create({ data: { tenantId: tenant.id, legislatureId: legislature.id, parliamentarianId: future.id, startDate: day12 } })
  expect((await db.$transaction((tx) => eligibleNoticeRecipients(tx, tenant.id, session.id))).map((person) => person.name).sort())
    .toEqual(['Mandato futuro', 'Suplente', 'Titular'])
  await db.tenant.update({ where: { id: tenant.id }, data: { settings: JSON.stringify({ noticeRecipientPolicy: 'mandate_and_leave' }) } })
  await db.leave.create({ data: { tenantId: tenant.id, parliamentarianId: titular.id, substituteId: suplente.id,
    kind: 'licenca', startDate: day10, endDate: new Date('2026-10-11T00:00:00Z'), reason: 'Licença no dia da sessão' } })
  expect((await db.$transaction((tx) => eligibleNoticeRecipients(tx, tenant.id, session.id))).map((person) => person.name))
    .toEqual(['Suplente'])
  const getPreview = (actorId: string) => preview(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/notice-recipient-preview`,
    { headers: { 'x-actor-id': actorId } }), { params: Promise.resolve({ id: session.id }) })
  const response = await getPreview(admin.id)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ policy: 'mandate_and_leave', total: 1, recipients: [{ name: 'Suplente' }] })
  expect((await getPreview(foreign.id)).status).toBe(403)
  await db.$transaction((tx) => snapshotNoticeRecipients(tx, { tenantId: tenant.id, sessionId: session.id, revision: 1,
    noticeSha256: 'a'.repeat(64), issuedAt: new Date('2026-10-11T12:00:00Z') }))
  expect((await db.sessionNoticeRecipient.findMany({ where: { sessionId: session.id } })).map((row) => row.recipientName))
    .toEqual(['Suplente'])
  await db.leave.updateMany({ where: { tenantId: tenant.id }, data: { endDate: day10 } })
  expect((await db.$transaction((tx) => eligibleNoticeRecipients(tx, tenant.id, session.id))).map((person) => person.name))
    .toEqual(['Titular'])
  // A revisão já emitida não muda com o fim da licença.
  expect((await db.sessionNoticeRecipient.findMany({ where: { sessionId: session.id } })).map((row) => row.recipientName))
    .toEqual(['Suplente'])
  expect(await db.$transaction((tx) => eligibleNoticeRecipients(tx, other.id, otherSession.id))).toEqual([])
  await expect(db.$transaction((tx) => snapshotNoticeRecipients(tx, { tenantId: other.id, sessionId: otherSession.id,
    revision: 1, noticeSha256: 'b'.repeat(64), issuedAt: new Date() }))).rejects.toMatchObject({ status: 409 })
})

test('publicação usa a política vigente e desfaz a transação sem destinatários', async () => {
  const tenant = await db.tenant.create({ data: { slug: 'recipients-policy-publish', name: 'Câmara Publicação', city: 'Cidade', uf: 'BA',
    timezone: 'UTC', settings: JSON.stringify({ noticeRecipientPolicy: 'mandate_and_leave' }) } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: 'recipient-policy-publish@example.invalid', role: 'tenant_admin' } })
  const titular = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Titular', party: 'SEM' } })
  const suplente = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Suplente', party: 'SEM' } })
  const legislature = await db.legislature.create({ data: { tenantId: tenant.id, number: 1, startYear: 2025, endYear: 2030 } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Matéria', authors: '[]' } })
  const scheduledAt = new Date(Date.now() + 3 * 86400000)
  const req = (url: string, body: unknown) => new NextRequest(url, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': admin.id }, body: JSON.stringify(body) })
  const created = await createSession(req('http://localhost/api/v1/sessions', { type: 'ordinaria', scheduledAt: scheduledAt.toISOString(),
    presidentId: titular.id, matterIds: [matter.id] }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const session = (await created.json()).session as { id: string; version: number }
  const schedule = () => transitionSession(req(`http://localhost/api/v1/sessions/${session.id}/transition`,
    { action: 'schedule', version: session.version }), { params: Promise.resolve({ id: session.id }) })
  expect((await schedule()).status).toBe(409)
  expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('draft')
  await db.mandate.create({ data: { tenantId: tenant.id, legislatureId: legislature.id,
    parliamentarianId: titular.id, startDate: new Date('2025-01-01T00:00:00Z') } })
  await db.leave.create({ data: { tenantId: tenant.id, parliamentarianId: titular.id, substituteId: suplente.id,
    kind: 'licenca', startDate: new Date('2025-01-01T00:00:00Z'), reason: 'Licença vigente' } })
  expect((await schedule()).status).toBe(200)
  const revision = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: session.id, revision: 1 } })
  expect(JSON.parse(revision.policyJson).noticeRecipientPolicy).toBe('mandate_and_leave')
  expect((await db.sessionNoticeRecipient.findMany({ where: { sessionId: session.id, revision: 1 } })).map((row) => row.recipientName))
    .toEqual(['Suplente'])
})
