import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PATCH as updateTenant } from '@/app/api/v1/tenants/[id]/route'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { PATCH as updateSession } from '@/app/api/v1/sessions/[id]/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { GET as agendaRevisions } from '@/app/api/v1/sessions/[id]/agenda-revisions/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, method: string, actorId: string, body?: unknown) => new NextRequest(url, {
  method, headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})

test('política de publicação é isolada por Câmara e fica congelada na revisão da pauta', async () => {
  const futureSessionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  async function house(slug: string) {
    const tenant = await db.tenant.create({ data: { slug, name: `Câmara ${slug}`, city: 'Cidade', uf: 'BA' } })
    const president = await db.parliamentarian.create({ data: {
      tenantId: tenant.id, name: `Presidente ${slug}`, party: 'SEM', boardRole: 'presidente',
    } })
    const actor = await db.user.create({ data: {
      tenantId: tenant.id, name: `Admin ${slug}`, email: `${slug}@example.invalid`, role: 'tenant_admin',
    } })
    return { tenant, president, actor }
  }
  const strict = await house('politica-estrita')
  const flexible = await house('politica-flexivel')
  const setting = await updateTenant(request(`http://localhost/api/v1/tenants/${strict.tenant.id}`, 'PATCH', strict.actor.id, {
    settings: {
      enabledSessionTypes: ['ordinaria'], requireSecretaryForPublication: true,
      minimumAgendaMatters: 1,
    },
  }), { params: Promise.resolve({ id: strict.tenant.id }) })
  expect(setting.status).toBe(200)

  const create = async (house: typeof strict, type: 'ordinaria' | 'especial', secretaryName?: string, matterIds?: string[]) =>
    createSession(request('http://localhost/api/v1/sessions', 'POST', house.actor.id, {
      type, scheduledAt: futureSessionDate, presidentId: house.president.id,
      secretaryName, matterIds,
    }), { params: Promise.resolve({}) })
  expect((await create(strict, 'especial')).status).toBe(422)
  const matter = await db.legislativeMatter.create({ data: {
    tenantId: strict.tenant.id, type: 'projeto_de_lei', number: 1, year: 2026,
    ementa: 'Teste da pauta', authors: '[]',
  } })
  const withoutSecretary = await create(strict, 'ordinaria', undefined, [matter.id])
  expect(withoutSecretary.status).toBe(201)
  const draft = (await withoutSecretary.json()).session
  const schedule = async (actorId: string, sessionId: string, version: number) => transitionSession(
    request(`http://localhost/api/v1/sessions/${sessionId}/transition`, 'POST', actorId,
      { action: 'schedule', version }),
    { params: Promise.resolve({ id: sessionId }) }
  )
  expect((await schedule(strict.actor.id, draft.id, draft.version)).status).toBe(409)
  expect(await db.sessionAgendaRevision.count({ where: { sessionId: draft.id } })).toBe(0)
  const edit = async (actorId: string, sessionId: string, body: unknown) => updateSession(
    request(`http://localhost/api/v1/sessions/${sessionId}`, 'PATCH', actorId, body),
    { params: Promise.resolve({ id: sessionId }) }
  )
  expect((await edit(flexible.actor.id, draft.id, { version: draft.version, secretaryName: 'Outra Câmara' })).status).toBe(403)
  expect((await edit(strict.actor.id, draft.id, { version: draft.version, presidentId: flexible.president.id })).status).toBe(404)
  expect((await edit(strict.actor.id, draft.id, { version: draft.version, scheduledAt: '2027-01-10T19:00:00.000Z' })).status).toBe(422)
  expect((await edit(strict.actor.id, draft.id, { version: draft.version, type: 'especial' })).status).toBe(422)
  const repaired = await edit(strict.actor.id, draft.id, { version: draft.version, secretaryName: 'Secretária' })
  expect(repaired.status).toBe(200)
  const repairedDraft = (await repaired.json()).session
  expect(repairedDraft.version).toBe(draft.version + 1)
  expect((await schedule(strict.actor.id, draft.id, draft.version)).status).toBe(409)
  expect((await schedule(strict.actor.id, draft.id, repairedDraft.version)).status).toBe(200)
  expect((await edit(strict.actor.id, draft.id, { version: repairedDraft.version + 1, notes: 'Tarde demais' })).status).toBe(409)

  const withoutMatter = await create(strict, 'ordinaria', 'Secretária')
  const noMatterDraft = (await withoutMatter.json()).session
  expect((await schedule(strict.actor.id, noMatterDraft.id, noMatterDraft.version)).status).toBe(409)

  const publishable = await create(strict, 'ordinaria', 'Secretária', [matter.id])
  const ready = (await publishable.json()).session
  expect((await schedule(strict.actor.id, ready.id, ready.version)).status).toBe(200)
  const revisions = await agendaRevisions(request(
    `http://localhost/api/v1/sessions/${ready.id}/agenda-revisions`, 'GET', strict.actor.id),
    { params: Promise.resolve({ id: ready.id }) })
  expect(revisions.status).toBe(200)
  const published = (await revisions.json()).revisions
  expect(published).toHaveLength(1)
  expect(published[0].number).toBe(1)
  expect(published[0].policy).toMatchObject({
    enabledSessionTypes: ['ordinaria'], requireSecretaryForPublication: true, minimumAgendaMatters: 1,
  })
  expect(published[0].agenda.some((item: { matterId: string | null }) => item.matterId === matter.id)).toBe(true)

  const otherHouse = await create(flexible, 'especial')
  expect(otherHouse.status).toBe(201)
  const otherDraft = (await otherHouse.json()).session
  expect((await schedule(flexible.actor.id, otherDraft.id, otherDraft.version)).status).toBe(200)
  const forbidden = await agendaRevisions(request(
    `http://localhost/api/v1/sessions/${ready.id}/agenda-revisions`, 'GET', flexible.actor.id),
    { params: Promise.resolve({ id: ready.id }) })
  expect(forbidden.status).toBe(403)

  await db.tenant.update({ where: { id: strict.tenant.id }, data: { settings: '{}' } })
  const frozen = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: ready.id } })
  expect(JSON.parse(frozen.policyJson).requireSecretaryForPublication).toBe(true)
})
