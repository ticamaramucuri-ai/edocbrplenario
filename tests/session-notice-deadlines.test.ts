import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as amendAgenda } from '@/app/api/v1/sessions/[id]/agenda-amendments/route'

afterAll(async () => { await db.$disconnect() })
const request = (url: string, actorId: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body),
})

test('prazos e urgência por Câmara e tipo ficam congelados na convocação', async () => {
  const tenant = await db.tenant.create({ data: {
    slug: 'prazo-urgencia', name: 'Câmara do Prazo', city: 'Cidade', uf: 'BA',
    settings: JSON.stringify({ minimumNoticeHours: 24, minimumAmendmentHours: 8, urgentNoticeExceptionTypes: ['extraordinaria'] }),
  } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente', party: 'SEM', boardRole: 'presidente' } })
  const actor = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: 'prazo-urgencia@example.invalid', role: 'tenant_admin' } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'requerimento', number: 1, year: 2026, ementa: 'Primeira', authors: '[]' } })
  const another = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'requerimento', number: 2, year: 2026, ementa: 'Segunda', authors: '[]' } })
  const create = async (type: 'ordinaria' | 'extraordinaria') => {
    const response = await createSession(request('http://localhost/api/v1/sessions', actor.id, {
      type, scheduledAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      presidentId: president.id, matterIds: [matter.id],
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(201)
    return (await response.json()).session as { id: string; version: number }
  }
  const normal = await create('ordinaria')
  const exceptional = await create('extraordinaria')
  const publish = (session: { id: string; version: number }, reason?: string) => transitionSession(
    request(`http://localhost/api/v1/sessions/${session.id}/transition`, actor.id,
      { action: 'schedule', version: session.version, ...(reason && { noticeExceptionReason: reason }) }),
    { params: Promise.resolve({ id: session.id }) })
  expect((await publish(normal)).status).toBe(409)
  expect((await publish(normal, 'Urgência fundamentada.')).status).toBe(409)
  expect((await publish(exceptional)).status).toBe(409)
  expect((await publish(exceptional, 'Convocação urgente aprovada.')).status).toBe(200)
  const first = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: exceptional.id, revision: 1 } })
  expect(JSON.parse(first.noticeJson!).exceptionReason).toBe('Convocação urgente aprovada.')
  expect(JSON.parse(first.policyJson).minimumNoticeHours).toBe(24)

  const current = await db.session.findUniqueOrThrow({ where: { id: exceptional.id } })
  const amend = (reason?: string) => amendAgenda(request(`http://localhost/api/v1/sessions/${exceptional.id}/agenda-amendments`, actor.id, {
    action: 'add', mode: 'apply', version: current.version, matterId: another.id,
    justification: 'Inclusão aprovada.', ...(reason && { exceptionReason: reason }),
  }), { params: Promise.resolve({ id: exceptional.id }) })
  expect((await amend()).status).toBe(409)
  expect((await amend('Retificação urgente aprovada.')).status).toBe(201)
  const second = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: exceptional.id, revision: 2 } })
  expect(JSON.parse(second.noticeJson!).exceptionReason).toBe('Retificação urgente aprovada.')
  expect(JSON.parse(second.policyJson).minimumAmendmentHours).toBe(8)
  expect(await db.sessionAgendaRevision.count({ where: { sessionId: normal.id } })).toBe(0)
  await db.tenant.update({ where: { id: tenant.id }, data: { settings: '{}' } })
  expect(JSON.parse(second.policyJson).minimumAmendmentHours).toBe(8)
})
