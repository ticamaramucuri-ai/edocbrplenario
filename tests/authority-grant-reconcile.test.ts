import { afterAll, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as grantAuthority } from '@/app/api/v1/sessions/[id]/authority/grant/route'
import { POST as reconcileAuthority } from '@/app/api/v1/sessions/[id]/authority/reconcile/route'

afterAll(async () => {
  delete process.env.LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY
  delete process.env.LOCAL_AUTHORITY_SIGNING_KEY_ID
  await db.$disconnect()
})

const post = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

test('concessão via API e reconciliação deduplicada de eventos locais com quarentena por época superada', async () => {
  const signer = generateKeyPairSync('ed25519')
  process.env.LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY = signer.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  process.env.LOCAL_AUTHORITY_SIGNING_KEY_ID = 'authority-test-key'

  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `rec-${suffix}`, name: 'Câmara Reconcile', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({
    data: { tenantId: tenant.id, name: 'Admin', email: `adm-${suffix}@example.invalid`, role: 'tenant_admin' },
  })
  const pubKey = generateKeyPairSync('ed25519').publicKey
  const device = await db.localServerDevice.create({
    data: {
      tenantId: tenant.id,
      name: 'Desktop Plenário',
      publicKeyPem: pubKey.export({ format: 'pem', type: 'spki' }).toString(),
      publicKeySpkiSha256: createHash('sha256').update(pubKey.export({ format: 'der', type: 'spki' }) as Buffer).digest('hex'),
      approvalReference: 'Aprovação Reconcile',
      createdById: admin.id,
    },
  })
  await db.localServerDesignation.create({
    data: { tenantId: tenant.id, deviceId: device.id, generation: 1, updatedById: admin.id },
  })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2042,
      scheduledAt: new Date('2042-01-01T12:00:00.000Z'),
      status: 'scheduled',
      agendaPublished: true,
    },
  })
  const revision = await db.sessionAgendaRevision.create({
    data: { tenantId: tenant.id, sessionId: session.id, revision: 1, agendaJson: '[]', policyJson: '{}', documentManifestJson: '[]' },
  })
  const manifestSha256 = 'd'.repeat(64)
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

  // 1. Concessão de autoridade via API
  const grantRes = await grantAuthority(
    post(`http://localhost/api/v1/sessions/${session.id}/authority/grant`, admin.id, {
      deviceId: device.id,
      revisionId: revision.id,
      manifestSha256,
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(grantRes.status).toBe(200)
  const grantBody = await grantRes.json()
  expect(grantBody.grant.grant.epoch).toBe(1)

  const cmd1 = crypto.randomUUID()
  const cmd2 = crypto.randomUUID()
  const events = [
    {
      seq: 2,
      commandId: cmd2,
      kind: 'vote.cast',
      payload: { value: 'sim' },
      occurredAt: new Date().toISOString(),
      entrySha256: 'e'.repeat(64),
    },
    {
      seq: 1,
      commandId: cmd1,
      kind: 'attendance.check_in',
      payload: { status: 'presente' },
      occurredAt: new Date().toISOString(),
      entrySha256: 'f'.repeat(64),
    },
  ]

  // 2. Reconciliação inicial
  const rec1 = await reconcileAuthority(
    post(`http://localhost/api/v1/sessions/${session.id}/authority/reconcile`, admin.id, {
      deviceId: device.id,
      epoch: 1,
      events,
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(rec1.status).toBe(200)
  const recBody1 = await rec1.json()
  expect(recBody1.ackedSeqs).toEqual([1, 2])
  expect(recBody1.deduplicatedCount).toBe(0)
  expect(recBody1.quarantined).toEqual([])

  // 3. Reenvio dos mesmos eventos -> deduplicado
  const rec2 = await reconcileAuthority(
    post(`http://localhost/api/v1/sessions/${session.id}/authority/reconcile`, admin.id, {
      deviceId: device.id,
      epoch: 1,
      events,
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(rec2.status).toBe(200)
  const recBody2 = await rec2.json()
  expect(recBody2.deduplicatedCount).toBe(2)

  // 4. Época antiga entra em quarentena se houver época 2 vigente
  await db.localSessionAuthorityLease.update({ where: { sessionId: session.id }, data: { epoch: 2 } })
  const recStale = await reconcileAuthority(
    post(`http://localhost/api/v1/sessions/${session.id}/authority/reconcile`, admin.id, {
      deviceId: device.id,
      epoch: 1,
      events: [events[0]],
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(recStale.status).toBe(200)
  const recBodyStale = await recStale.json()
  expect(recBodyStale.quarantined.length).toBe(1)
})
