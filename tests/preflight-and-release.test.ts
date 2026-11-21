import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as getPreflight } from '@/app/api/v1/sessions/[id]/preflight/route'
import { POST as releaseAuthority } from '@/app/api/v1/sessions/[id]/authority/release/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'

afterAll(async () => {
  await db.$disconnect()
})

const post = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

test('preflight reporta bloqueios, autoridade local ativa e liberação desbloqueia a web', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `pf-${suffix}`, name: 'Câmara Pré-Voo', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({
    data: { tenantId: tenant.id, name: 'Operador', email: `op-${suffix}@example.invalid`, role: 'session_operator' },
  })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Ver. PF', party: 'SEM' } })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2041,
      scheduledAt: new Date('2041-01-01T12:00:00.000Z'),
      status: 'open',
      agendaPublished: true,
      official: true,
    },
  })
  await db.agendaItem.create({
    data: { sessionId: session.id, section: 'ordem_dia', order: 0, title: 'Item 1', status: 'pendente' },
  })
  await db.attendanceEvent.create({
    data: { sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente' },
  })
  const voting = await db.voting.create({
    data: { sessionId: session.id, question: 'Questão PF?', mode: 'nominal', status: 'open' },
  })
  const device = await db.localServerDevice.create({
    data: {
      tenantId: tenant.id,
      name: 'Desktop Plenário',
      publicKeyPem: 'pem',
      publicKeySpkiSha256: 'c'.repeat(64),
      approvalReference: 'Teste PF',
      createdById: operator.id,
    },
  })
  const revision = await db.sessionAgendaRevision.create({
    data: { tenantId: tenant.id, sessionId: session.id, revision: 1, agendaJson: '[]', policyJson: '{}', documentManifestJson: '[]' },
  })
  const now = new Date()
  await db.localSessionAuthorityLease.create({
    data: {
      sessionId: session.id,
      tenantId: tenant.id,
      deviceId: device.id,
      revisionId: revision.id,
      manifestSha256: 'a'.repeat(64),
      epoch: 1,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      signingKeyId: 'k1',
      signedGrantJson: '{}',
    },
  })

  // Preflight acusa autoridade local ativa
  const pf1 = await getPreflight(
    new NextRequest(`http://localhost/api/v1/sessions/${session.id}/preflight`, { headers: { 'x-actor-id': operator.id } }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(pf1.status).toBe(200)
  const pfBody1 = await pf1.json()
  expect(pfBody1.preflight.localAuthority.active).toBe(true)
  expect(pfBody1.preflight.readyForWebOpen).toBe(false)

  // Liberação exige justificativa mínima
  const badRel = await releaseAuthority(
    post(`http://localhost/api/v1/sessions/${session.id}/authority/release`, operator.id, { justification: 'ok' }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(badRel.status).toBe(422)

  // Liberação válida encerra concessão e desbloqueia votação web
  const relRes = await releaseAuthority(
    post(`http://localhost/api/v1/sessions/${session.id}/authority/release`, operator.id, {
      justification: 'Retomada controlada para operação web pela Mesa.',
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(relRes.status).toBe(200)

  const pf2 = await getPreflight(
    new NextRequest(`http://localhost/api/v1/sessions/${session.id}/preflight`, { headers: { 'x-actor-id': operator.id } }),
    { params: Promise.resolve({ id: session.id }) }
  )
  const pfBody2 = await pf2.json()
  expect(pfBody2.preflight.localAuthority.active).toBe(false)
  expect(pfBody2.preflight.readyForWebOpen).toBe(true)

  const voteRes = await castVote(
    post(`http://localhost/api/v1/votings/${voting.id}/votes`, operator.id, {
      parliamentarianId: member.id,
      value: 'sim',
      commandId: crypto.randomUUID(),
    }),
    { params: Promise.resolve({ id: voting.id }) }
  )
  expect(voteRes.status).toBe(200)
})
