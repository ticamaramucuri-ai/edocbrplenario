import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as addAgendaMatter } from '@/app/api/v1/sessions/[id]/agenda/route'
import { PATCH as updateAgendaItem } from '@/app/api/v1/agenda-items/[itemId]/route'

afterAll(async () => { await db.$disconnect() })

test('preparação: duas criações recebem números distintos, ficam em rascunho e só publicam por comando', async () => {
  const tenant = await db.tenant.create({ data: {
    slug: 'camara-ensaio', name: 'Câmara de Ensaio', city: 'Ensaio', uf: 'BA',
    timezone: 'America/Bahia',
  } })
  const president = await db.parliamentarian.create({ data: {
    tenantId: tenant.id, name: 'Presidência de Ensaio', party: 'SEM', boardRole: 'presidente',
  } })
  const actor = await db.user.create({ data: {
    tenantId: tenant.id, name: 'Operador de Ensaio', email: 'operador@ensaio.example', role: 'tenant_admin',
  } })
  const matter = await db.legislativeMatter.create({ data: {
    tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026,
    ementa: 'Matéria de ensaio', authors: '[]',
  } })
  const request = (matterIds: string[]) => new NextRequest('http://localhost/api/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actor.id },
    body: JSON.stringify({
      type: 'ordinaria', scheduledAt: '2027-01-01T01:00:00.000Z',
      presidentId: president.id, matterIds,
    }),
  })
  const ctx = { params: Promise.resolve({}) }
  const [first, second] = await Promise.all([
    createSession(request([matter.id]), ctx),
    createSession(request([matter.id]), ctx),
  ])
  expect(first.status).toBe(201)
  expect(second.status).toBe(201)
  const created = [await first.json(), await second.json()].map((r) => r.session)
  expect(created.map((s) => s.number).sort()).toEqual([1, 2])
  for (const session of created) {
    expect(session.year).toBe(2026) // 01:00 UTC ainda é 31/12 na Bahia
    expect(session.status).toBe('draft')
    expect(session.agendaPublished).toBe(false)
    expect(await db.agendaItem.count({ where: { sessionId: session.id } })).toBe(5)
  }
  const duplicate = await createSession(request([matter.id, matter.id]), ctx)
  expect(duplicate.status).toBe(422)
  expect(await db.session.count({ where: { tenantId: tenant.id } })).toBe(2)

  const publish = await transitionSession(new NextRequest(
    `http://localhost/api/v1/sessions/${created[0].id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': actor.id },
      body: JSON.stringify({ action: 'schedule', version: created[0].version }),
    }
  ), { params: Promise.resolve({ id: created[0].id }) })
  expect(publish.status).toBe(200)
  const updated = await db.session.findUniqueOrThrow({ where: { id: created[0].id } })
  expect(updated.status).toBe('scheduled')
  expect(updated.agendaPublished).toBe(true)
  expect((await db.session.findUniqueOrThrow({ where: { id: created[1].id } })).status).toBe('draft')

  const addAfterPublication = await addAgendaMatter(new NextRequest(
    `http://localhost/api/v1/sessions/${created[0].id}/agenda`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actor.id },
      body: JSON.stringify({ matterIds: [matter.id] }),
    }
  ), { params: Promise.resolve({ id: created[0].id }) })
  expect(addAfterPublication.status).toBe(409)
  const firstItem = await db.agendaItem.findFirstOrThrow({ where: { sessionId: created[0].id } })
  const reorderAfterPublication = await updateAgendaItem(new NextRequest(
    `http://localhost/api/v1/agenda-items/${firstItem.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-actor-id': actor.id },
      body: JSON.stringify({ action: 'reorder', order: 2 }),
    }
  ), { params: Promise.resolve({ itemId: firstItem.id }) })
  expect(reorderAfterPublication.status).toBe(409)
})
