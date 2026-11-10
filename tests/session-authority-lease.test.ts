import { afterAll, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { LocalServerDevice } from '@prisma/client'
import { db } from '@/lib/db'
import { reserveSessionAuthorityLease } from '@/lib/server/session-authority-lease'
import { verifySessionAuthorityGrant } from '@/lib/session-authority-contract'

const signer = generateKeyPairSync('ed25519')
const manifestSha256 = 'a'.repeat(64)
const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 12, minute))

afterAll(async () => { await db.$disconnect() })

async function fixture() {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `authority-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `authority-other-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin',
    email: `${suffix}@example.invalid`, role: 'tenant_admin' } })
  const devices: LocalServerDevice[] = []
  for (let i = 0; i < 2; i++) {
    const publicKey = generateKeyPairSync('ed25519').publicKey
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
    const publicKeySpkiSha256 = createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' }) as Buffer).digest('hex')
    devices.push(await db.localServerDevice.create({ data: { tenantId: tenant.id, name: `Desktop ${i + 1}`,
      publicKeyPem, publicKeySpkiSha256, approvalReference: 'Aprovação de ensaio', createdById: admin.id } }))
  }
  await db.localServerDesignation.create({ data: { tenantId: tenant.id, deviceId: devices[0].id,
    generation: 1, updatedById: admin.id } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: at(0), status: 'scheduled', agendaPublished: true } })
  const revision = await db.sessionAgendaRevision.create({ data: { tenantId: tenant.id,
    sessionId: session.id, revision: 1, agendaJson: '[]', policyJson: '{}', documentManifestJson: '[]' } })
  async function acknowledge(deviceId: string, revisionId = revision.id) {
    await db.localSessionTransferIssue.create({ data: { tenantId: tenant.id, deviceId,
      sessionId: session.id, revisionId, revisionNumber: 1, manifestSha256,
      artifactHashesJson: '[]', acknowledgedAt: at(0) } })
  }
  const request = (deviceId = devices[0].id, now = at(0)) => ({ tenantId: tenant.id,
    sessionId: session.id, deviceId, revisionId: revision.id, manifestSha256,
    keyId: 'test-key-1', privateKey: signer.privateKey, correlationId: crypto.randomUUID(), now })
  return { tenant, other, devices, session, revision, acknowledge, request }
}

test('concessão exige importação confirmada, escopo e pauta atual', async () => {
  const f = await fixture()
  await expect(reserveSessionAuthorityLease(f.request())).rejects.toMatchObject({ code: 'LOCAL_AUTHORITY_PRECONDITION' })
  await f.acknowledge(f.devices[0].id)
  await expect(reserveSessionAuthorityLease({ ...f.request(), tenantId: f.other.id })).rejects.toMatchObject({ code: 'LOCAL_AUTHORITY_PRECONDITION' })
  const newer = await db.sessionAgendaRevision.create({ data: { tenantId: f.tenant.id,
    sessionId: f.session.id, revision: 2, agendaJson: '[]', policyJson: '{}', documentManifestJson: '[]' } })
  await expect(reserveSessionAuthorityLease(f.request())).rejects.toMatchObject({ code: 'LOCAL_AUTHORITY_PRECONDITION' })
  expect(newer.revision).toBe(2)
  expect(await db.localSessionAuthorityLease.count({ where: { sessionId: f.session.id } })).toBe(0)
})

test('uma concessão por sessão; renovação e troca só respeitam época e vencimento', async () => {
  const f = await fixture()
  await f.acknowledge(f.devices[0].id)
  const first = await reserveSessionAuthorityLease(f.request())
  expect(first.grant.epoch).toBe(1)
  const replay = await reserveSessionAuthorityLease(f.request(f.devices[0].id, at(1)))
  expect(replay).toEqual(first)
  const renewed = await reserveSessionAuthorityLease(f.request(f.devices[0].id, at(11)))
  expect(renewed.grant.epoch).toBe(2)
  expect(verifySessionAuthorityGrant(renewed, { tenantId: f.tenant.id, sessionId: f.session.id,
    deviceId: f.devices[0].id, revisionId: f.revision.id, manifestSha256,
    trustedKeys: new Map([['test-key-1', signer.publicKey]]), now: at(12), minimumEpoch: 2 }).epoch).toBe(2)

  await db.localServerDesignation.update({ where: { tenantId: f.tenant.id }, data: {
    deviceId: f.devices[1].id, generation: { increment: 1 } } })
  await f.acknowledge(f.devices[1].id)
  await expect(reserveSessionAuthorityLease(f.request(f.devices[1].id, at(12)))).rejects.toMatchObject({ code: 'LOCAL_AUTHORITY_CONFLICT' })
  await expect(reserveSessionAuthorityLease(f.request(f.devices[0].id, at(12)))).rejects.toMatchObject({ code: 'LOCAL_AUTHORITY_PRECONDITION' })
  const switched = await reserveSessionAuthorityLease(f.request(f.devices[1].id, at(27)))
  expect(switched.grant.epoch).toBe(3)
  expect(switched.grant.deviceId).toBe(f.devices[1].id)
  expect(await db.auditEvent.count({ where: { tenantId: f.tenant.id, action: 'local_authority.reserved' } })).toBe(3)
})

test('pedidos simultâneos repetem o mesmo epoch, sem conceder duas autoridades', async () => {
  const f = await fixture()
  await f.acknowledge(f.devices[0].id)
  const results = await Promise.all(Array.from({ length: 3 }, () => reserveSessionAuthorityLease(f.request())))
  expect(results.every((result) => result.grant.epoch === 1 && result.grant.deviceId === f.devices[0].id)).toBe(true)
  expect(await db.localSessionAuthorityLease.count({ where: { sessionId: f.session.id } })).toBe(1)
  expect(await db.auditEvent.count({ where: { tenantId: f.tenant.id, action: 'local_authority.reserved' } })).toBe(1)
}, 20_000)

test('reenvio recusa divergência entre concessão assinada e linha persistida', async () => {
  const f = await fixture()
  await f.acknowledge(f.devices[0].id)
  await reserveSessionAuthorityLease(f.request())
  await db.localSessionAuthorityLease.update({ where: { sessionId: f.session.id }, data: { epoch: 0 } })
  await expect(reserveSessionAuthorityLease(f.request(f.devices[0].id, at(1)))).rejects.toMatchObject({
    code: 'LOCAL_AUTHORITY_PRECONDITION',
  })
})

if (process.env.DATABASE_URL?.startsWith('postgresql:')) {
  test('três processos PostgreSQL recebem a mesma concessão sem duplicar época ou auditoria', async () => {
    const f = await fixture()
    await f.acknowledge(f.devices[0].id)
    const payload = JSON.stringify({ tenantId: f.tenant.id, sessionId: f.session.id,
      deviceId: f.devices[0].id, revisionId: f.revision.id, manifestSha256,
      keyId: 'test-key-1', privateKeyPem: signer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      now: at(0).toISOString() })
    const callWorker = () => new Promise<{ grant: { epoch: number; deviceId: string } }>((resolve, reject) => {
      const child = spawn(process.execPath, ['tests/helpers/session-authority-lease-worker.ts'], {
        cwd: process.cwd(), env: { ...process.env, TEST_AUTHORITY_LEASE_ARGS: payload }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) reject(new Error(`Worker de concessão falhou: ${stderr.slice(-1000)}`))
        else {
          try {
            const line = stdout.split('\n').find((item) => item.startsWith('AUTHORITY_GRANT:'))
            if (!line) throw new Error(`Worker não retornou concessão: ${stdout.slice(-1000)}`)
            resolve(JSON.parse(line.slice('AUTHORITY_GRANT:'.length)) as { grant: { epoch: number; deviceId: string } })
          }
          catch (error) { reject(error) }
        }
      })
    })
    const grants = await Promise.all([callWorker(), callWorker(), callWorker()])
    expect(grants.every((item) => item.grant.epoch === 1 && item.grant.deviceId === f.devices[0].id)).toBe(true)
    expect(await db.localSessionAuthorityLease.count({ where: { sessionId: f.session.id } })).toBe(1)
    expect(await db.auditEvent.count({ where: { tenantId: f.tenant.id, action: 'local_authority.reserved' } })).toBe(1)
  }, 30_000)
}
