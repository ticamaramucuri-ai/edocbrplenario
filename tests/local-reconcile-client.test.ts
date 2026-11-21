import { afterAll, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { openLocalEventJournal } from '@/lib/local-event-journal'
import { pushLocalJournalBatch } from '@/lib/local-reconcile-client'
import { buildSessionDetail } from '@/lib/server/serializers'
import { POST as grantAuthority } from '@/app/api/v1/sessions/[id]/authority/grant/route'
import { POST as reconcileAuthority } from '@/app/api/v1/sessions/[id]/authority/reconcile/route'

afterAll(async () => {
  delete process.env.LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY
  delete process.env.LOCAL_AUTHORITY_SIGNING_KEY_ID
  await db.$disconnect()
})

test('diário local -> cliente de reconciliação -> SaaS aplica eventos e buildSessionDetail expõe pareceres na pauta', async () => {
  const suffix = crypto.randomUUID()
  const authoritySigner = generateKeyPairSync('ed25519')
  process.env.LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY = authoritySigner.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  process.env.LOCAL_AUTHORITY_SIGNING_KEY_ID = 'authority-e2e-key'

  const deviceKeys = generateKeyPairSync('ed25519')
  const tenant = await db.tenant.create({ data: { slug: `e2e-${suffix}`, name: 'Câmara E2E', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({
    data: { tenantId: tenant.id, name: 'Admin', email: `adm-${suffix}@example.invalid`, role: 'tenant_admin' },
  })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Ver. E2E', party: 'SEM' } })
  const device = await db.localServerDevice.create({
    data: {
      tenantId: tenant.id,
      name: 'Desktop E2E',
      publicKeyPem: deviceKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      publicKeySpkiSha256: createHash('sha256').update(deviceKeys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).digest('hex'),
      approvalReference: 'E2E Test',
      createdById: admin.id,
    },
  })
  await db.localServerDesignation.create({
    data: { tenantId: tenant.id, deviceId: device.id, generation: 1, updatedById: admin.id },
  })
  const matter = await db.legislativeMatter.create({
    data: {
      tenantId: tenant.id,
      type: 'PL',
      number: 5,
      year: 2044,
      ementa: 'Ementa parecer',
      authors: JSON.stringify(['Mesa']),
      status: 'em_pauta',
    },
  })
  await db.matterAttachment.create({
    data: { matterId: matter.id, name: 'Parecer.pdf', kind: 'parecer', sizeBytes: 100 },
  })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2044,
      scheduledAt: new Date('2044-01-01T12:00:00.000Z'),
      status: 'scheduled',
      agendaPublished: true,
    },
  })
  await db.agendaItem.create({
    data: { sessionId: session.id, matterId: matter.id, section: 'ordem_dia', order: 0, title: 'PL 5/2044', status: 'pendente' },
  })
  const detail = await buildSessionDetail(db, session)
  expect(detail.agenda[0].attachmentsCount).toBe(1)
  expect(detail.agenda[0].hasParecer).toBe(true)

  const revision = await db.sessionAgendaRevision.create({
    data: { tenantId: tenant.id, sessionId: session.id, revision: 1, agendaJson: '[]', policyJson: '{}', documentManifestJson: '[]' },
  })
  const manifestSha256 = 'a'.repeat(64)
  await db.localSessionTransferIssue.create({
    data: {
      tenantId: tenant.id,
      deviceId: device.id,
      sessionId: session.id,
      revisionId: revision.id,
      revisionNumber: 1,
      manifestSha256,
      artifactHashesJson: '[]',
      acknowledgedAt: new Date(),
    },
  })

  const grantRes = await grantAuthority(
    new NextRequest(`http://localhost/api/v1/sessions/${session.id}/authority/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': admin.id },
      body: JSON.stringify({ deviceId: device.id, revisionId: revision.id, manifestSha256 }),
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  const { grant } = await grantRes.json()

  const dir = mkdtempSync(join(tmpdir(), 'edocbr-journal-e2e-'))
  chmodSync(dir, 0o700)
  try {
    const journal = openLocalEventJournal({
      root: dir,
      tenantId: tenant.id,
      deviceId: device.id,
      privateKey: deviceKeys.privateKey,
    })
    journal.acceptAuthorityGrant({
      sessionId: session.id,
      revisionId: revision.id,
      manifestSha256,
      signed: grant,
      trustedKeys: new Map([['authority-e2e-key', authoritySigner.publicKey]]),
    })
    journal.append({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      expectedSequence: 0,
      eventType: 'attendance.check_in',
      actorId: admin.id,
      payload: { parliamentarianId: member.id, status: 'presente' },
    })
    const offlineVotingId = `voting-local-${suffix}`
    journal.append({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      expectedSequence: 1,
      eventType: 'voting.opened',
      actorId: admin.id,
      payload: { votingId: offlineVotingId, question: 'PL 5/2044', mode: 'nominal' },
    })
    journal.append({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      expectedSequence: 2,
      eventType: 'vote.cast',
      actorId: admin.id,
      payload: { votingId: offlineVotingId, parliamentarianId: member.id, value: 'sim' },
    })
    journal.append({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      expectedSequence: 3,
      eventType: 'voting.closed',
      actorId: admin.id,
      payload: { votingId: offlineVotingId },
    })
    const speechCmdId = crypto.randomUUID()
    journal.append({
      sessionId: session.id,
      commandId: speechCmdId,
      expectedSequence: 4,
      eventType: 'speech.started',
      actorId: admin.id,
      payload: { parliamentarianId: member.id, durationSeconds: 180 },
    })
    journal.append({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      expectedSequence: 5,
      eventType: 'speech.stopped',
      actorId: admin.id,
      payload: {},
    })

    const events = journal.list(session.id, 0)
    const batch = await pushLocalJournalBatch({
      baseUrl: 'http://localhost',
      sessionId: session.id,
      deviceId: device.id,
      epoch: 1,
      events,
      headers: { 'x-actor-id': admin.id },
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        return reconcileAuthority(
          new NextRequest(String(url), {
            method: init?.method ?? 'POST',
            headers: init?.headers,
            body: init?.body,
          }),
          { params: Promise.resolve({ id: session.id }) }
        )
      }) as typeof fetch,
    })
    expect(batch.reconciled).toBe(true)
    expect(batch.appliedCount).toBe(6)
    expect(batch.lastAckedSeq).toBe(6)

    const materializedVoting = await db.voting.findUnique({
      where: { id: offlineVotingId },
      include: { votes: true },
    })
    expect(materializedVoting?.status).toBe('closed')
    expect(materializedVoting?.votes).toHaveLength(1)
    expect(materializedVoting?.votes[0].value).toBe('sim')

    const materializedSpeech = await db.speech.findUnique({ where: { id: speechCmdId } })
    expect(materializedSpeech?.status).toBe('encerrado')
    journal.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
