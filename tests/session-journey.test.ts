import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as attendance } from '@/app/api/v1/sessions/[id]/attendance/route'
import { POST as enqueueSpeech } from '@/app/api/v1/sessions/[id]/speeches/route'
import { POST as transitionSpeech } from '@/app/api/v1/speeches/[id]/transition/route'
import { POST as createVoting } from '@/app/api/v1/sessions/[id]/votings/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'
import { GET as mediaStatus } from '@/app/api/v1/sessions/[id]/transmission/route'
import { GET as ataReport } from '@/app/api/v1/reports/session/[id]/ata/route'
import { GET as publicSession } from '@/app/api/v1/public/sessions/[id]/route'
import { GET as publicNotice } from '@/app/api/v1/public/sessions/[id]/notices/route'

const originalFetch = globalThis.fetch
const originalMetrics = process.env.MEDIA_METRICS_URL
afterAll(async () => {
  globalThis.fetch = originalFetch
  if (originalMetrics === undefined) delete process.env.MEDIA_METRICS_URL
  else process.env.MEDIA_METRICS_URL = originalMetrics
  await db.$disconnect()
})

const post = (url: string, actorId: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body),
})
const get = (url: string, actorId?: string) => new NextRequest(url, actorId ? { headers: { 'x-actor-id': actorId } } : {})
const context = (id: string) => ({ params: Promise.resolve({ id }) })

test('duas Câmaras: sessão completa continua após perda de mídia e correção auditável', async () => {
  const suffix = crypto.randomUUID()
  const setup = async (name: string) => {
    const tenant = await db.tenant.create({ data: { slug: `${name}-${suffix}`, name, city: 'Ensaio', uf: 'BA', settings: JSON.stringify({ quorumMinimum: 1 }) } })
    const actor = await db.user.create({ data: { tenantId: tenant.id, name: `Operador ${name}`, email: `${name}-${suffix}@example.invalid`, role: 'tenant_admin' } })
    const voteOperator = await db.user.create({ data: { tenantId: tenant.id, name: `Mesa ${name}`, email: `mesa-${name}-${suffix}@example.invalid`, role: 'session_operator' } })
    const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: `Presidência ${name}`, party: 'SEM', boardRole: 'presidente' } })
    const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: `Matéria ${name}`, authors: '[]' } })
    const response = await createSession(post('http://localhost/api/v1/sessions', actor.id, {
      type: 'ordinaria', scheduledAt: '2027-01-20T13:00:00.000Z', presidentId: president.id, matterIds: [matter.id],
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(201)
    const session = (await response.json()).session as { id: string; version: number }
    const item = await db.agendaItem.findFirstOrThrow({ where: { sessionId: session.id, matterId: matter.id } })
    return { tenant, actor, voteOperator, president, session, item }
  }
  const a = await setup('camara-a')
  const b = await setup('camara-b')
  const sessionAction = async (actorId: string, id: string, action: string, version: number) => transitionSession(
    post(`http://localhost/api/v1/sessions/${id}/transition`, actorId, { action, version }), context(id))
  const voteAction = async (id: string, action: string, version: number, extra: object = {}) => transitionVoting(
    post(`http://localhost/api/v1/votings/${id}/transition`, a.actor.id, { action, version, ...extra }), context(id))

  expect((await sessionAction(b.actor.id, a.session.id, 'schedule', 1)).status).toBe(403)
  expect((await sessionAction(a.actor.id, a.session.id, 'schedule', 1)).status).toBe(200)
  expect((await sessionAction(b.actor.id, b.session.id, 'schedule', 1)).status).toBe(200)
  const notice = await publicNotice(get(`http://localhost/api/v1/public/sessions/${a.session.id}/notices?tenant=${a.tenant.slug}`), context(a.session.id))
  expect(notice.status).toBe(200)
  expect((await notice.json()).sha256).toHaveLength(64)
  expect((await publicNotice(get(`http://localhost/api/v1/public/sessions/${a.session.id}/notices?tenant=${b.tenant.slug}`), context(a.session.id))).status).toBe(404)
  expect((await sessionAction(a.actor.id, a.session.id, 'open_checkin', 2)).status).toBe(200)
  expect((await attendance(post(`http://localhost/api/v1/sessions/${a.session.id}/attendance`, a.actor.id,
    { parliamentarianId: a.president.id, action: 'check_in' }), context(a.session.id))).status).toBe(200)
  expect((await sessionAction(a.actor.id, a.session.id, 'open_session', 3)).status).toBe(200)
  const speechResponse = await enqueueSpeech(post(`http://localhost/api/v1/sessions/${a.session.id}/speeches`, a.actor.id,
    { parliamentarianId: a.president.id, kind: 'grande_expediente', subject: 'Discussão de ensaio' }), context(a.session.id))
  expect(speechResponse.status).toBe(201)
  const speechId = (await speechResponse.json()).speech.id as string
  for (const action of ['start', 'finish']) expect((await transitionSpeech(post(
    `http://localhost/api/v1/speeches/${speechId}/transition`, a.actor.id, { action }), context(speechId))).status).toBe(200)

  process.env.MEDIA_METRICS_URL = 'http://127.0.0.1:19998/metrics'
  globalThis.fetch = (async () => new Response(`paths{name="session-${a.session.id}",state="ready"} 0\n`)) as unknown as typeof fetch
  await db.transmission.create({ data: { tenantId: a.tenant.id, sessionId: a.session.id, status: 'monitoring' } })
  const media = await mediaStatus(get(`http://localhost/api/v1/sessions/${a.session.id}/transmission`, a.actor.id), context(a.session.id))
  expect((await media.json()).transmission.effectiveStatus).toBe('signal_lost')

  const nominal = await createVoting(post(`http://localhost/api/v1/sessions/${a.session.id}/votings`, a.actor.id,
    { agendaItemId: a.item.id, mode: 'nominal' }), context(a.session.id))
  expect(nominal.status).toBe(201)
  const nominalId = (await nominal.json()).voting.id as string
  expect((await voteAction(nominalId, 'open', 1)).status).toBe(200)
  const commandId = crypto.randomUUID()
  const cast = () => castVote(post(`http://localhost/api/v1/votings/${nominalId}/votes`, a.voteOperator.id,
    { parliamentarianId: a.president.id, value: 'sim', commandId }), context(nominalId))
  expect((await cast()).status).toBe(200)
  expect((await cast()).status).toBe(200)
  expect(await db.vote.count({ where: { votingId: nominalId } })).toBe(1)
  expect(await db.outboxEvent.count({ where: { aggregateId: nominalId, eventType: 'vote.recorded' } })).toBe(1)
  expect((await voteAction(nominalId, 'close', 2)).status).toBe(200)
  expect((await voteAction(nominalId, 'close', 2)).status).toBe(409)
  expect((await voteAction(nominalId, 'annul', 3, { justification: 'Correção da questão apresentada' })).status).toBe(200)
  const symbolic = await createVoting(post(`http://localhost/api/v1/sessions/${a.session.id}/votings`, a.actor.id,
    { agendaItemId: a.item.id, mode: 'simbolico' }), context(a.session.id))
  expect(symbolic.status).toBe(201)
  const symbolicId = (await symbolic.json()).voting.id as string
  expect((await voteAction(symbolicId, 'open', 1)).status).toBe(200)
  expect((await voteAction(symbolicId, 'close', 2, { sim: 1, nao: 0, abstencoes: 0 })).status).toBe(200)
  expect((await sessionAction(a.actor.id, a.session.id, 'close', 4)).status).toBe(200)
  expect((await sessionAction(a.actor.id, a.session.id, 'close', 4)).status).toBe(409)
  const ata = await ataReport(get(`http://localhost/api/v1/reports/session/${a.session.id}/ata`, a.actor.id), context(a.session.id))
  expect(ata.status).toBe(200)
  const ataBody = (await ata.json()).ata
  expect(ataBody.votings).toHaveLength(2)
  expect(ataBody.speeches).toHaveLength(1)
  expect(ataBody.session.status).toBe('closed')
  const portal = await publicSession(get(`http://localhost/api/v1/public/sessions/${a.session.id}?tenant=${a.tenant.slug}`), context(a.session.id))
  expect(portal.status).toBe(200)
  const publicBody = await portal.json()
  expect(publicBody.votings).toHaveLength(2)
  expect(publicBody.speeches).toHaveLength(1)
  expect(publicBody.attendance.presentCount).toBe(1)
  expect((await publicSession(get(`http://localhost/api/v1/public/sessions/${a.session.id}?tenant=${b.tenant.slug}`), context(a.session.id))).status).toBe(404)
  expect((await db.session.findUniqueOrThrow({ where: { id: b.session.id } })).status).toBe('scheduled')
  expect(await db.auditEvent.count({ where: { tenantId: a.tenant.id, action: 'voting.annulled' } })).toBe(1)
})
