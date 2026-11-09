/** Disposable PostgreSQL proof: two tenants prepare and download large PDFs concurrently. */
import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as issueManifest } from '@/app/api/v1/sessions/[id]/transfer-manifest/route'
import { GET as downloadArtifact } from '@/app/api/v1/sessions/[id]/transfer-artifacts/[artifactId]/route'
import { signedLocalDeviceGet } from '@/lib/local-device-http'
import { transferManifestV1Schema, verifySignedTransferManifest,
  type TransferSignatureV1 } from '@/lib/session-transfer-contract'
import { freezeTransferContext } from '@/lib/server/session-transfer-context'
import { provisionTransferSigningKey } from '@/lib/server/session-transfer-signing'

const sizes = [8 * 1024 * 1024, 16 * 1024 * 1024]
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const root = await mkdtemp(join(tmpdir(), 'edocbr-transfer-capacity-'))
process.env.EDOCBR_TRANSFER_KEY_ROOT = root

type Fixture = { tenantId: string; sessionId: string; deviceId: string; privateKey: KeyObject;
  trustedKeys: ReadonlyMap<string, KeyObject>; expected: Map<string, string> }

function pdfBytes(size: number, mark: number): Buffer {
  const bytes = Buffer.alloc(size, mark)
  bytes.write('%PDF-1.4\n', 0, 'ascii')
  bytes.write('\n%%EOF', bytes.length - 6, 'ascii')
  return bytes
}

async function fixture(index: number): Promise<Fixture> {
  const tenant = await db.tenant.create({ data: { slug: `transfer-capacity-${index}-${randomUUID()}`,
    name: `Câmara fictícia ${index}`, city: 'Ensaio', uf: 'BA' } })
  const person = await db.parliamentarian.create({ data: { tenantId: tenant.id,
    name: `Operador fictício ${index}`, party: 'TST', active: true } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date(Date.now() + 86400_000), status: 'scheduled', agendaPublished: true,
    presidentId: person.id } })
  const references: Array<Record<string, unknown>> = []
  const expected = new Map<string, string>()
  for (const [position, size] of sizes.entries()) {
    const bytes = pdfBytes(size, 0x41 + index + position)
    const document = await db.sessionDocument.create({ data: { tenantId: tenant.id,
      sessionId: session.id, kind: position === 0 ? 'pauta' : 'apoio', version: 1,
      name: `Documento ${position + 1}.pdf`, mimeType: 'application/pdf',
      sizeBytes: bytes.length, sha256: hash(bytes), content: Uint8Array.from(bytes), createdById: person.id } })
    references.push({ id: document.id, kind: document.kind, version: document.version,
      name: document.name, mimeType: document.mimeType, sizeBytes: document.sizeBytes,
      sha256: document.sha256 })
    expected.set(`session-document:${document.id}`, document.sha256)
  }
  const revision = await db.sessionAgendaRevision.create({ data: { tenantId: tenant.id,
    sessionId: session.id, revision: 1, agendaJson: '[]',
    policyJson: JSON.stringify({ minimumAgendaMatters: 0 }),
    matterManifestJson: JSON.stringify({ version: 1, matters: [], unavailableAttachmentIds: [] }),
    documentManifestJson: JSON.stringify(references) } })
  await db.$transaction((tx) => freezeTransferContext(tx, {
    tenantId: tenant.id, sessionId: session.id, revisionId: revision.id }))
  const signing = await provisionTransferSigningKey({ root, tenantId: tenant.id })
  const deviceKeys = generateKeyPairSync('ed25519')
  const device = await db.localServerDevice.create({ data: { tenantId: tenant.id,
    name: `Servidor local fictício ${index}`,
    publicKeyPem: deviceKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    publicKeySpkiSha256: hash(deviceKeys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer),
    approvalReference: 'ensaio descartável', createdById: person.id } })
  await db.localServerDesignation.create({ data: { tenantId: tenant.id,
    deviceId: device.id, updatedById: person.id } })
  return { tenantId: tenant.id, sessionId: session.id, deviceId: device.id,
    privateKey: deviceKeys.privateKey,
    trustedKeys: new Map([[signing.active.keyId, createPublicKey(signing.publicKeyPem)]]), expected }
}

function request(args: Fixture, pathAndQuery: string, tenantId = args.tenantId) {
  const signed = signedLocalDeviceGet({ baseUrl: 'https://example.invalid', tenantId,
    deviceId: args.deviceId, privateKey: args.privateKey, pathAndQuery })
  return new NextRequest(signed.url, { method: signed.init.method, headers: signed.init.headers })
}

async function main() {
  assert.match(process.env.DATABASE_URL ?? '', /^postgres(ql)?:\/\//)
  const fixtures = await Promise.all([fixture(1), fixture(2)])
  const baselineRss = process.memoryUsage().rss
  let peakRss = baselineRss
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 20)
  try {
    const started = performance.now()
    const issued = await Promise.all(fixtures.map(async (item) => {
      const response = await issueManifest(request(item,
        `/api/v1/sessions/${item.sessionId}/transfer-manifest`),
      { params: Promise.resolve({ id: item.sessionId }) })
      assert.equal(response.status, 200)
      const body = await response.json() as { issueId: string; manifest: unknown; signature: TransferSignatureV1 }
      const manifest = transferManifestV1Schema.parse(body.manifest)
      verifySignedTransferManifest({ manifest, signature: body.signature,
        expectedTenantId: item.tenantId, expectedSessionId: item.sessionId,
        minimumRevisionNumber: 0, trustedKeys: item.trustedKeys })
      assert.equal(manifest.artifacts.length, 2)
      assert.equal(manifest.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
        sizes.reduce((sum, size) => sum + size, 0))
      return { item, issueId: body.issueId, manifest }
    }))
    const issuedMs = Math.round(performance.now() - started)
    const downloads = issued.flatMap(({ item, issueId, manifest }) => manifest.artifacts.map((artifact) =>
      ({ item, issueId, artifact })))
    const downloadStarted = performance.now()
    const perArtifactMs = await Promise.all(downloads.map(async ({ item, issueId, artifact }) => {
      const startedAt = performance.now()
      const pathAndQuery = `/api/v1/sessions/${item.sessionId}/transfer-artifacts/` +
        `${encodeURIComponent(artifact.id)}?issueId=${encodeURIComponent(issueId)}`
      const response = await downloadArtifact(request(item, pathAndQuery),
        { params: Promise.resolve({ id: item.sessionId, artifactId: artifact.id }) })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(bytes.length, artifact.sizeBytes)
      assert.equal(hash(bytes), item.expected.get(artifact.id))
      return Math.round(performance.now() - startedAt)
    }))
    const downloadsMs = Math.round(performance.now() - downloadStarted)
    const alien = issued[0]
    const alienArtifact = alien.manifest.artifacts[0]
    const alienPath = `/api/v1/sessions/${alien.item.sessionId}/transfer-artifacts/` +
      `${encodeURIComponent(alienArtifact.id)}?issueId=${encodeURIComponent(alien.issueId)}`
    const alienResponse = await downloadArtifact(request(alien.item, alienPath, fixtures[1].tenantId),
      { params: Promise.resolve({ id: alien.item.sessionId, artifactId: alienArtifact.id }) })
    assert.equal(alienResponse.status, 401)
    console.log(JSON.stringify({ transferCapacityEvidence: { tenants: fixtures.length,
      artifacts: downloads.length, bytes: fixtures.length * sizes.reduce((sum, size) => sum + size, 0),
      issuedMs, downloadsMs, maxArtifactMs: Math.max(...perArtifactMs),
      baselineRssMiB: Math.round(baselineRss / 1048576),
      sampledPeakRssMiB: Math.round(peakRss / 1048576),
      environment: 'disposable local PostgreSQL; direct route handlers; synthetic PDFs' } }))
  } finally { clearInterval(sampler) }
}

try { await main() }
finally { await db.$disconnect(); await rm(root, { recursive: true, force: true }) }
