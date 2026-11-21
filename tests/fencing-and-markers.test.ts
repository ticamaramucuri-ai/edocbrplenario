import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as markAttendance } from '@/app/api/v1/sessions/[id]/attendance/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as transitionSpeech } from '@/app/api/v1/speeches/[id]/transition/route'
import { GET as getPublicSession } from '@/app/api/v1/public/sessions/[id]/route'

afterAll(async () => {
  await db.$disconnect()
})

const post = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

test('cercamento web bloqueia mutações quando concessão local está ativa e libera após expiração', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `fence-${suffix}`, name: 'Câmara Fence', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({
    data: { tenantId: tenant.id, name: 'Operador', email: `op-${suffix}@example.invalid`, role: 'session_operator' },
  })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Ver. Fence', party: 'SEM' } })
  const openedAt = new Date('2040-04-01T12:00:00.000Z')
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2040,
      scheduledAt: openedAt,
      openedAt,
      status: 'open',
      official: true,
    },
  })
  await db.attendanceEvent.create({
    data: { sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente' },
  })
  const voting = await db.voting.create({
    data: {
      sessionId: session.id,
      question: 'Aprovar PL Fence?',
      mode: 'nominal',
      status: 'open',
      openedAt: new Date(openedAt.getTime() + 120_000),
    },
  })
  const speech = await db.speech.create({
    data: {
      sessionId: session.id,
      parliamentarianId: member.id,
      kind: 'grande_expediente',
      plannedSeconds: 300,
      status: 'fila',
    },
  })

  // Ativa concessão de autoridade local vigente
  const now = new Date()
  const device = await db.localServerDevice.create({
    data: {
      tenantId: tenant.id,
      name: 'Desktop Plenário',
      publicKeyPem: 'pem-test',
      publicKeySpkiSha256: 'b'.repeat(64),
      approvalReference: 'Teste fencing',
      createdById: operator.id,
    },
  })
  const revision = await db.sessionAgendaRevision.create({
    data: {
      tenantId: tenant.id,
      sessionId: session.id,
      revision: 1,
      agendaJson: '[]',
      policyJson: '{}',
      documentManifestJson: '[]',
    },
  })
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
      signingKeyId: 'key-1',
      signedGrantJson: '{}',
    },
  })

  const attRes = await markAttendance(
    post(`http://localhost/api/v1/sessions/${session.id}/attendance`, operator.id, {
      parliamentarianId: member.id,
      action: 'check_in',
      commandId: crypto.randomUUID(),
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(attRes.status).toBe(409)
  expect((await attRes.json()).code).toBe('LOCAL_AUTHORITY_ACTIVE')

  const voteRes = await castVote(
    post(`http://localhost/api/v1/votings/${voting.id}/votes`, operator.id, {
      parliamentarianId: member.id,
      value: 'sim',
      commandId: crypto.randomUUID(),
    }),
    { params: Promise.resolve({ id: voting.id }) }
  )
  expect(voteRes.status).toBe(409)
  expect((await voteRes.json()).code).toBe('LOCAL_AUTHORITY_ACTIVE')

  const vtRes = await transitionVoting(
    post(`http://localhost/api/v1/votings/${voting.id}/transition`, operator.id, {
      action: 'close',
      version: voting.version,
    }),
    { params: Promise.resolve({ id: voting.id }) }
  )
  expect(vtRes.status).toBe(409)
  expect((await vtRes.json()).code).toBe('LOCAL_AUTHORITY_ACTIVE')

  const spRes = await transitionSpeech(
    post(`http://localhost/api/v1/speeches/${speech.id}/transition`, operator.id, { action: 'start' }),
    { params: Promise.resolve({ id: speech.id }) }
  )
  expect(spRes.status).toBe(409)
  expect((await spRes.json()).code).toBe('LOCAL_AUTHORITY_ACTIVE')

  // Expira a concessão e confirma que a web volta a operar
  await db.localSessionAuthorityLease.update({
    where: { sessionId: session.id },
    data: { expiresAt: new Date(now.getTime() - 1000) },
  })
  const voteAfter = await castVote(
    post(`http://localhost/api/v1/votings/${voting.id}/votes`, operator.id, {
      parliamentarianId: member.id,
      value: 'sim',
      commandId: crypto.randomUUID(),
    }),
    { params: Promise.resolve({ id: voting.id }) }
  )
  expect(voteAfter.status).toBe(200)

  // Valida replayMarkers no endpoint público
  const pubRes = await getPublicSession(
    new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(pubRes.status).toBe(200)
  const pubBody = await pubRes.json()
  expect(Array.isArray(pubBody.replayMarkers)).toBe(true)
  expect(pubBody.replayMarkers.some((m: { type: string }) => m.type === 'session_opened')).toBe(true)
  expect(pubBody.replayMarkers.some((m: { type: string; offsetSeconds: number }) => m.type === 'voting_opened' && m.offsetSeconds === 120)).toBe(true)
})
