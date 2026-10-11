import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { GET as publicNotice } from '@/app/api/v1/public/sessions/[id]/notices/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, method: string, actorId: string | null, body?: unknown) => new NextRequest(url, {
  method, headers: { 'content-type': 'application/json', ...(actorId ? { 'x-actor-id': actorId } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
})

test('convocação aplica antecedência por Câmara e publica conteúdo verificável no tenant correto', async () => {
  const house = async (slug: string, minimumNoticeHours: number) => {
    const tenant = await db.tenant.create({ data: { slug, name: `Câmara ${slug}`, city: slug, uf: 'BA', settings: JSON.stringify({ minimumNoticeHours }) } })
    const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente', party: 'SEM', boardRole: 'presidente' } })
    const actor = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `${slug}@example.invalid`, role: 'tenant_admin' } })
    return { tenant, president, actor }
  }
  const strict = await house('prazo-estrito', 72)
  const flexible = await house('prazo-flexivel', 0)
  const create = async (h: typeof strict, hours: number) => {
    const scheduledAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    const response = await createSession(request('http://localhost/api/v1/sessions', 'POST', h.actor.id, {
      type: 'ordinaria', scheduledAt, presidentId: h.president.id,
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(201)
    return (await response.json()).session as { id: string; version: number }
  }
  const publish = (actorId: string, session: { id: string; version: number }) => transitionSession(
    request(`http://localhost/api/v1/sessions/${session.id}/transition`, 'POST', actorId, { action: 'schedule', version: session.version }),
    { params: Promise.resolve({ id: session.id }) })
  const tooSoon = await create(strict, 24)
  expect((await publish(strict.actor.id, tooSoon)).status).toBe(409)
  expect(await db.sessionAgendaRevision.count({ where: { sessionId: tooSoon.id } })).toBe(0)
  const allowed = await create(flexible, 24)
  expect((await publish(flexible.actor.id, allowed)).status).toBe(200)
  const compliant = await create(strict, 96)
  expect((await publish(strict.actor.id, compliant)).status).toBe(200)

  const read = (slug: string, id: string) => publicNotice(request(`http://localhost/api/v1/public/sessions/${id}/notices?tenant=${slug}&revision=1`, 'GET', null), { params: Promise.resolve({ id }) })
  expect((await read('prazo-flexivel', compliant.id)).status).toBe(404)
  expect((await read('prazo-estrito', tooSoon.id)).status).toBe(404)
  const response = await read('prazo-estrito', compliant.id)
  expect(response.status).toBe(200)
  const payload = await response.json()
  expect(payload.notice.policy.minimumNoticeHours).toBe(72)
  expect(payload.notice.tenant.slug).toBe('prazo-estrito')
  expect(payload.notice.tenant.settings).toBeUndefined()
  expect(payload.notice.revision).toBe(1)
  expect(payload.sha256).toBe(createHash('sha256').update(JSON.stringify(payload.notice)).digest('hex'))

  await db.tenant.update({ where: { id: strict.tenant.id }, data: { settings: '{}' } })
  const frozen = await read('prazo-estrito', compliant.id)
  expect((await frozen.json()).notice.policy.minimumNoticeHours).toBe(72)
})
