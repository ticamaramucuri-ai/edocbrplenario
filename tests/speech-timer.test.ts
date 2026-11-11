import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as attendance } from '@/app/api/v1/sessions/[id]/attendance/route'
import { POST as enqueueSpeech } from '@/app/api/v1/sessions/[id]/speeches/route'
import { POST as transitionSpeech } from '@/app/api/v1/speeches/[id]/transition/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, actorId: string, body?: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const context = (id: string) => ({ params: Promise.resolve({ id }) })

test('fila e cronômetro: escopo, transições, tempo acumulado e eventos auditáveis', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: {
    slug: `speech-${suffix}`, name: 'Câmara de Teste', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ minimumAgendaMatters: 1, speechDefaultSeconds: 300 }),
  } })
  const other = await db.tenant.create({ data: { slug: `speech-out-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `speech-admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const media = await db.user.create({ data: { tenantId: tenant.id, name: 'Mídia', email: `speech-media-${suffix}@example.invalid`, role: 'media_operator' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Externo', email: `speech-out-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Parlamentar Teste', party: 'SEM' } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidência', party: 'SEM', boardRole: 'presidente' } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Matéria teste de fala', authors: '[]' } })

  const created = await createSession(request('http://localhost/api/v1/sessions', admin.id, {
    type: 'ordinaria', scheduledAt: new Date(Date.now() + 30 * 86400000).toISOString(), presidentId: president.id, matterIds: [matter.id],
  }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const session = (await created.json()).session as { id: string; version: number }
  const sessionAction = (action: string, version: number) => transitionSession(
    request(`http://localhost/api/v1/sessions/${session.id}/transition`, admin.id, { action, version }), context(session.id))
  expect((await sessionAction('schedule', session.version)).status).toBe(200)
  expect((await sessionAction('open_checkin', 2)).status).toBe(200)
  expect((await attendance(request(`http://localhost/api/v1/sessions/${session.id}/attendance`, admin.id,
    { parliamentarianId: president.id, action: 'check_in' }), context(session.id))).status).toBe(200)
  expect((await sessionAction('open_session', 3)).status).toBe(200)

  const enqueue = (actorId: string, body: unknown) => enqueueSpeech(
    request(`http://localhost/api/v1/sessions/${session.id}/speeches`, actorId, body), context(session.id))
  expect((await enqueue(outsider.id, { externalSpeaker: 'Pessoa de fora', kind: 'ordem' })).status).toBe(403)
  expect((await enqueue(media.id, { externalSpeaker: 'Pessoa de fora', kind: 'ordem' })).status).toBe(403)
  expect((await enqueue(admin.id, { kind: 'ordem' })).status).toBe(422)
  expect((await enqueue(admin.id, { parliamentarianId: member.id, kind: 'ordem', plannedSeconds: 29 })).status).toBe(422)

  const firstResponse = await enqueue(admin.id, { parliamentarianId: member.id, kind: 'grande_expediente', subject: 'Assunto de teste' })
  expect(firstResponse.status).toBe(201)
  const firstId = (await firstResponse.json()).speech.id as string
  expect((await enqueue(admin.id, { parliamentarianId: 'membro-de-outra-camara', kind: 'ordem' })).status).toBe(422)
  const secondResponse = await enqueue(admin.id, { externalSpeaker: 'Orador convidado', kind: 'homenagem' })
  expect(secondResponse.status).toBe(201)
  const secondId = (await secondResponse.json()).speech.id as string

  const transition = (id: string, action: string, seconds?: number) => transitionSpeech(
    request(`http://localhost/api/v1/speeches/${id}/transition`, admin.id, { action, ...(seconds === undefined ? {} : { seconds }) }), context(id))
  expect((await transition(firstId, 'resume')).status).toBe(409)
  expect((await transition(firstId, 'start')).status).toBe(200)
  expect((await transition(secondId, 'start')).status).toBe(409)
  await db.speech.update({ where: { id: firstId }, data: { startedAt: new Date(Date.now() - 65_000) } })
  expect((await transition(firstId, 'pause')).status).toBe(200)
  const paused = await db.speech.findUniqueOrThrow({ where: { id: firstId } })
  expect(paused.status).toBe('pausado')
  expect(paused.elapsedSeconds).toBeGreaterThanOrEqual(64)
  expect(paused.elapsedSeconds).toBeLessThanOrEqual(66)
  expect((await transition(firstId, 'pause')).status).toBe(409)
  expect((await transition(firstId, 'resume')).status).toBe(200)
  await db.speech.update({ where: { id: firstId }, data: { startedAt: new Date(Date.now() - 10_000) } })
  expect((await transition(firstId, 'extend', 45)).status).toBe(200)
  expect((await transition(firstId, 'finish')).status).toBe(200)
  const finished = await db.speech.findUniqueOrThrow({ where: { id: firstId } })
  expect(finished.status).toBe('encerrado')
  expect(finished.plannedSeconds).toBe(345)
  expect(finished.elapsedSeconds).toBeGreaterThanOrEqual(74)
  expect(finished.elapsedSeconds).toBeLessThanOrEqual(76)
  expect((await transition(firstId, 'extend', 30)).status).toBe(409)
  expect((JSON.parse(finished.timerEvents ?? '[]') as Array<{ acao: string }>).map((event) => event.acao))
    .toEqual(['iniciar', 'pausar', 'retomar', 'estender', 'encerrar'])
  expect(await db.auditEvent.count({ where: { aggregateId: firstId, action: { startsWith: 'speech.' } } })).toBe(6)
  expect(await db.outboxEvent.count({ where: { aggregateId: firstId, eventType: 'speech.state_changed' } })).toBe(6)
  expect((await transition(secondId, 'start')).status).toBe(200)
})
