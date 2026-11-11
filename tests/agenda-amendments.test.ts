import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as amendAgenda } from '@/app/api/v1/sessions/[id]/agenda-amendments/route'
import { GET as publicDetail } from '@/app/api/v1/public/sessions/[id]/route'
import { PATCH as updateAgendaItem } from '@/app/api/v1/agenda-items/[itemId]/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, method: string, actorId: string | null, body?: unknown) => new NextRequest(url, {
  method, headers: { 'content-type': 'application/json', ...(actorId ? { 'x-actor-id': actorId } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
})

test('emenda publicada tem prévia, revisão pública e isolamento por Câmara', async () => {
  const futureSessionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const tenant = await db.tenant.create({ data: { slug: 'emenda-a', name: 'Câmara A', city: 'A', uf: 'BA', settings: JSON.stringify({ minimumAgendaMatters: 1 }) } })
  const other = await db.tenant.create({ data: { slug: 'emenda-b', name: 'Câmara B', city: 'B', uf: 'BA' } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente', party: 'SEM', boardRole: 'presidente' } })
  const actor = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin A', email: 'emenda-a@example.invalid', role: 'tenant_admin' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Admin B', email: 'emenda-b@example.invalid', role: 'tenant_admin' } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Primeira matéria', authors: '[]' } })
  const addedMatter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'requerimento', number: 2, year: 2026, ementa: 'Segunda matéria', authors: '[]' } })
  const foreignMatter = await db.legislativeMatter.create({ data: { tenantId: other.id, type: 'requerimento', number: 1, year: 2026, ementa: 'Matéria estrangeira', authors: '[]' } })
  const created = await createSession(request('http://localhost/api/v1/sessions', 'POST', actor.id, {
    type: 'ordinaria', scheduledAt: futureSessionDate, presidentId: president.id, matterIds: [matter.id],
  }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const draft = (await created.json()).session
  const sessionId = draft.id as string
  const transition = (action: string, version: number) => transitionSession(request(`http://localhost/api/v1/sessions/${sessionId}/transition`, 'POST', actor.id, { action, version }), { params: Promise.resolve({ id: sessionId }) })
  expect((await transition('schedule', draft.version)).status).toBe(200)
  const published = await db.session.findUniqueOrThrow({ where: { id: sessionId } })
  const amend = (actorId: string, body: unknown) => amendAgenda(request(`http://localhost/api/v1/sessions/${sessionId}/agenda-amendments`, 'POST', actorId, body), { params: Promise.resolve({ id: sessionId }) })
  const add = { action: 'add', version: published.version, matterId: addedMatter.id, justification: 'Inclusão aprovada pela presidência.' }

  expect((await amend(outsider.id, { ...add, mode: 'preview' })).status).toBe(403)
  expect((await amend(actor.id, { ...add, mode: 'preview', matterId: foreignMatter.id })).status).toBe(404)
  const preview = await amend(actor.id, { ...add, mode: 'preview' })
  expect(preview.status).toBe(200)
  const proposed = (await preview.json()).preview
  expect(proposed.revision).toBe(2)
  expect(proposed.after.length).toBe(proposed.before.length + 1)
  expect(await db.sessionAgendaRevision.count({ where: { sessionId } })).toBe(1)
  const applied = await amend(actor.id, { ...add, mode: 'apply' })
  expect(applied.status).toBe(201)
  expect((await applied.json()).amendment.revision).toBe(2)
  const issued = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId, revision: 2 } })
  expect(issued.noticeSha256).toHaveLength(64)
  const amendedSession = await db.session.findUniqueOrThrow({ where: { id: sessionId } })
  expect(JSON.parse(issued.transferContextJson!)).toMatchObject({ sessionVersion: amendedSession.version,
    rosterSnapshot: [{ parliamentarianId: president.id }] })
  expect(JSON.parse(issued.noticeJson!).justification).toBe(add.justification)
  expect((await amend(actor.id, { ...add, mode: 'apply' })).status).toBe(409)
  expect(await db.sessionAgendaRevision.count({ where: { sessionId } })).toBe(2)
  const publicResponse = await publicDetail(request(`http://localhost/api/v1/public/sessions/${sessionId}?tenant=emenda-a`, 'GET', null), { params: Promise.resolve({ id: sessionId }) })
  expect(publicResponse.status).toBe(200)
  const publicSession = await publicResponse.json()
  expect(publicSession.agendaRevision).toMatchObject({ number: 2, justification: add.justification })
  expect(publicSession.agenda.some((item: { title: string }) => item.title.includes('Segunda matéria'))).toBe(true)
  expect((await publicDetail(request(`http://localhost/api/v1/public/sessions/${sessionId}?tenant=emenda-b`, 'GET', null), { params: Promise.resolve({ id: sessionId }) })).status).toBe(404)

  const current = await db.session.findUniqueOrThrow({ where: { id: sessionId } })
  const firstItem = await db.agendaItem.findFirstOrThrow({ where: { sessionId, matterId: matter.id } })
  const retire = { action: 'retire', version: current.version, itemId: firstItem.id, justification: 'Retirada da pauta.' }
  expect((await amend(actor.id, { ...retire, mode: 'preview' })).status).toBe(200)
  expect((await amend(actor.id, { ...retire, mode: 'apply' })).status).toBe(201)
  const secondItem = await db.agendaItem.findFirstOrThrow({ where: { sessionId, matterId: addedMatter.id } })
  const afterRetire = await db.session.findUniqueOrThrow({ where: { id: sessionId } })
  expect((await amend(actor.id, { action: 'retire', mode: 'preview', version: afterRetire.version, itemId: secondItem.id, justification: 'Outra retirada.' })).status).toBe(409)
  const moved = await amend(actor.id, { action: 'move', mode: 'apply', version: afterRetire.version, itemId: secondItem.id, position: 0, justification: 'Prioridade para discussão.' })
  expect(moved.status).toBe(201)
  expect((await db.agendaItem.findUniqueOrThrow({ where: { id: secondItem.id } })).order).toBeLessThan((await db.agendaItem.findUniqueOrThrow({ where: { id: firstItem.id } })).order)
  const later = await db.session.findUniqueOrThrow({ where: { id: sessionId } })
  expect((await transition('open_checkin', later.version)).status).toBe(200)
  expect((await amend(actor.id, { action: 'add', mode: 'apply', version: later.version + 1, matterId: foreignMatter.id, justification: 'Fora da janela.' })).status).toBe(409)
  expect((await updateAgendaItem(request(`http://localhost/api/v1/agenda-items/${firstItem.id}`, 'PATCH', actor.id, { action: 'retirar', justification: 'Sem emenda.' }), { params: Promise.resolve({ itemId: firstItem.id }) })).status).toBe(409)
})
