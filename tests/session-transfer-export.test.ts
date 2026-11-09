import { afterAll, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { buildSessionTransferCandidate } from '@/lib/server/session-transfer-export'
import { captureMatterSnapshot, freezeMatterSnapshot } from '@/lib/server/session-matter-snapshot'
import { freezeTransferContext } from '@/lib/server/session-transfer-context'
import { canonicalManifest, signPreparedPackage, verifyPreparedPackage } from '@/lib/session-transfer-contract'
import { importPreparedPackage, readPreparedPackage } from '@/lib/local-session-package-store'
import { GET as downloadTransfer } from '@/app/api/v1/sessions/[id]/transfer/route'
import { GET as issueTransferManifest } from '@/app/api/v1/sessions/[id]/transfer-manifest/route'
import { GET as downloadTransferArtifact } from '@/app/api/v1/sessions/[id]/transfer-artifacts/[artifactId]/route'
import { localDeviceRequestMessage } from '@/lib/server/local-device-identity'
import { provisionTransferSigningKey } from '@/lib/server/session-transfer-signing'
import { issueSessionTransfer } from '@/lib/server/session-transfer-issuance'
import { readTransferPackage } from '@/lib/session-transfer-wire'
import { downloadAndPrepareSession } from '@/lib/local-device-client'
import { GET as listLocalPreparations } from '@/app/api/v1/local-preparations/route'
import { POST as acknowledgeTransfer } from '@/app/api/v1/sessions/[id]/transfer-ack/route'
import { GET as transferStatus } from '@/app/api/v1/sessions/[id]/transfer-status/route'
import { discoverPreparedSessions, synchronizePreparedSessions } from '@/lib/local-session-discovery'
import { signedLocalDeviceGet, signedLocalDevicePost } from '@/lib/local-device-http'

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
let publicRoot: string
let localRoot: string
let keyRoot: string
let ids: { tenant: string; other: string; session: string; matter: string; attachment: string; document: string }

afterAll(async () => {
  await db.$disconnect()
  if (publicRoot) await rm(publicRoot, { recursive: true, force: true })
  if (localRoot) await rm(localRoot, { recursive: true, force: true })
  if (keyRoot) await rm(keyRoot, { recursive: true, force: true })
})

test('revisão publicada exporta bytes de PDF e anexo local, texto e política assináveis', async () => {
  publicRoot = await mkdtemp(join(tmpdir(), 'edocbr-transfer-public-'))
  const attachmentBytes = Buffer.from('%PDF-1.4\nAnexo sintético\n%%EOF')
  const tenant = await db.tenant.create({ data: { slug: 'transfer-a', name: 'Câmara A', city: 'Teste', uf: 'BA', settings: JSON.stringify({ quorumMinimum: 3 }) } })
  const other = await db.tenant.create({ data: { slug: 'transfer-b', name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  await mkdir(join(publicRoot, 'tenants', tenant.id), { recursive: true })
  await writeFile(join(publicRoot, 'tenants', tenant.id, 'anexo.pdf'), attachmentBytes)
  const person = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidência', party: 'AAA', boardRole: 'presidente' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date('2026-12-01T12:00:00Z'), status: 'scheduled', agendaPublished: true,
    presidentId: person.id } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei',
    number: 1, year: 2026, ementa: 'Projeto de ensaio', authors: '["Autora"]' } })
  await db.matterVersion.create({ data: { matterId: matter.id, version: 1, text: 'Texto integral de ensaio', authorName: 'Autora' } })
  const attachment = await db.matterAttachment.create({ data: { matterId: matter.id, name: 'Anexo.pdf',
    sizeBytes: attachmentBytes.length, url: `/tenants/${tenant.id}/anexo.pdf` } })
  const agenda = await db.agendaItem.create({ data: { sessionId: session.id, order: 0, matterId: matter.id,
    title: 'Projeto de ensaio' } })
  const content = Buffer.from('%PDF-1.4\nPauta sintética\n%%EOF')
  const document = await db.sessionDocument.create({ data: { tenantId: tenant.id, sessionId: session.id,
    kind: 'pauta', version: 1, name: 'Pauta.pdf', sizeBytes: content.length, sha256: hash(content),
    content, createdById: person.id } })
  const revision = await db.sessionAgendaRevision.create({ data: { tenantId: tenant.id, sessionId: session.id, revision: 1,
    agendaJson: JSON.stringify([{ id: agenda.id, order: 0, matterId: matter.id, title: agenda.title }]),
    policyJson: JSON.stringify({ minimumAgendaMatters: 1 }),
    documentManifestJson: JSON.stringify([{ id: document.id, kind: document.kind, version: document.version,
      name: document.name, mimeType: document.mimeType, sizeBytes: document.sizeBytes, sha256: document.sha256 }]) } })
  await db.$transaction(async (tx) => {
    await freezeMatterSnapshot(tx, { revisionId: revision.id, tenantId: tenant.id,
      agenda: [{ matterId: matter.id }], publicRoot })
    await freezeTransferContext(tx, { revisionId: revision.id, tenantId: tenant.id, sessionId: session.id })
  })
  ids = { tenant: tenant.id, other: other.id, session: session.id, matter: matter.id,
    attachment: attachment.id, document: document.id }

  const candidate = await buildSessionTransferCandidate({ tenantId: tenant.id, sessionId: session.id })
  expect(candidate.manifest.artifacts).toHaveLength(2)
  expect(candidate.manifest.matterSnapshot[0].latestText).toBe('Texto integral de ensaio')
  expect(candidate.manifest.deliberationPolicySnapshot.quorumMinimum).toBe(3)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signature = signPreparedPackage(candidate.manifest, candidate.bytesById, 'test-key', privateKey)
  expect(verifyPreparedPackage({ manifest: candidate.manifest, signature,
    bytesById: candidate.bytesById, expectedTenantId: tenant.id, expectedSessionId: session.id,
    minimumRevisionNumber: 1, trustedKeys: new Map([['test-key', publicKey]]) }).revisionNumber).toBe(1)
  localRoot = await mkdtemp(join(tmpdir(), 'edocbr-local-import-'))
  const localArgs = { root: localRoot, expectedTenantId: tenant.id, expectedSessionId: session.id,
    trustedKeys: new Map([['test-key', publicKey]]) }
  await importPreparedPackage({ ...localArgs, ...candidate, signature })
  expect((await readPreparedPackage(localArgs)).manifest.revisionId).toBe(candidate.manifest.revisionId)
  await expect(buildSessionTransferCandidate({ tenantId: other.id, sessionId: session.id })).rejects.toThrow('não encontrada')

  keyRoot = await mkdtemp(join(tmpdir(), 'edocbr-transfer-keys-'))
  const signing = await provisionTransferSigningKey({ root: keyRoot, tenantId: tenant.id })
  process.env.EDOCBR_TRANSFER_KEY_ROOT = keyRoot
  const deviceKeys = generateKeyPairSync('ed25519')
  const device = await db.localServerDevice.create({ data: { tenantId: tenant.id, name: 'Servidor de ensaio',
    publicKeyPem: deviceKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    publicKeySpkiSha256: hash(deviceKeys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer),
    approvalReference: 'Teste automatizado', createdById: person.id } })
  await db.localServerDesignation.create({ data: { tenantId: tenant.id, deviceId: device.id, updatedById: person.id } })
  const url = `https://example.invalid/api/v1/sessions/${session.id}/transfer`
  const context = { params: Promise.resolve({ id: session.id }) }
  const request = (tenantId: string, nonce = randomBytes(24).toString('base64url')) => {
    const timestamp = String(Date.now())
    const message = localDeviceRequestMessage({ tenantId, deviceId: device.id, method: 'GET',
      pathAndQuery: new URL(url).pathname, timestamp, nonce })
    return new NextRequest(url, { headers: { 'x-edocbr-tenant-id': tenantId,
      'x-edocbr-device-id': device.id, 'x-edocbr-device-timestamp': timestamp,
      'x-edocbr-device-nonce': nonce,
      'x-edocbr-device-signature': sign(null, message, deviceKeys.privateKey).toString('base64') } })
  }
  expect((await downloadTransfer(new NextRequest(url), context)).status).toBe(401)
  const wrongTenant = await downloadTransfer(request(other.id), context)
  expect(wrongTenant.status).toBe(401)
  const signedRequest = request(tenant.id)
  const response = await downloadTransfer(signedRequest, context)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  const wire = await readTransferPackage(response.body!)
  expect((await issueTransferManifest(new NextRequest(`https://example.invalid/api/v1/sessions/${session.id}/transfer-manifest`), context)).status).toBe(401)
  expect((await downloadTransferArtifact(new NextRequest(`https://example.invalid/api/v1/sessions/${session.id}/transfer-artifacts/${encodeURIComponent(candidate.manifest.artifacts[0].id)}?issueId=unknown`),
    { params: Promise.resolve({ id: session.id, artifactId: candidate.manifest.artifacts[0].id }) })).status).toBe(401)
  const trustedKeys = new Map([[signing.active.keyId, (await import('node:crypto')).createPublicKey(signing.publicKeyPem)]])
  const wireLocalRoot = await mkdtemp(join(tmpdir(), 'edocbr-wire-import-'))
  try {
    await importPreparedPackage({ root: wireLocalRoot, ...wire,
      expectedTenantId: tenant.id, expectedSessionId: session.id, trustedKeys })
    expect((await readPreparedPackage({ root: wireLocalRoot, expectedTenantId: tenant.id,
      expectedSessionId: session.id, trustedKeys })).manifest.revisionId).toBe(candidate.manifest.revisionId)
  } finally { await rm(wireLocalRoot, { recursive: true, force: true }) }
  const clientRoot = await mkdtemp(join(tmpdir(), 'edocbr-client-import-'))
  let dropFirstAck = true
  let secondArtifactFailures = 2
  let transferDownloads = 0
  const artifactDownloads = new Map<string, number>()
  const routeFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new NextRequest(String(input), { method: init?.method, headers: init?.headers,
      body: init?.body as BodyInit | undefined })
    const path = new URL(request.url).pathname
    if (path === '/api/v1/local-preparations') return listLocalPreparations(request, { params: Promise.resolve({}) })
    if (path.endsWith('/transfer-status')) return transferStatus(request, context)
    if (path.endsWith('/transfer-ack')) {
      if (dropFirstAck) { dropFirstAck = false; return new Response(null, { status: 503 }) }
      return acknowledgeTransfer(request, context)
    }
    if (path.includes('/transfer-artifacts/')) {
      const artifactId = decodeURIComponent(path.split('/transfer-artifacts/')[1])
      artifactDownloads.set(artifactId, (artifactDownloads.get(artifactId) ?? 0) + 1)
      if (artifactId === candidate.manifest.artifacts[1].id && secondArtifactFailures > 0) {
        const failure = secondArtifactFailures--
        const original = candidate.bytesById.get(artifactId)!
        const content = failure === 2 ? original.subarray(0, original.length - 1) : Buffer.alloc(original.length, 0x42)
        return new Response(new Uint8Array(content), { headers: { 'content-type': 'application/octet-stream' } })
      }
      return downloadTransferArtifact(request, { params: Promise.resolve({ id: session.id, artifactId }) })
    }
    if (path.endsWith('/transfer-manifest')) { transferDownloads++; return issueTransferManifest(request, context) }
    transferDownloads++
    return downloadTransfer(request, context)
  }) as typeof fetch
  const clientArgs = { baseUrl: 'https://example.invalid', tenantId: tenant.id, sessionId: session.id,
    deviceId: device.id, privateKey: deviceKeys.privateKey, trustedKeys, localRoot: clientRoot,
    fetchImpl: routeFetch }
  try {
    const manifestPath = `/api/v1/sessions/${session.id}/transfer-manifest`
    const manifestRequest = signedLocalDeviceGet({ ...clientArgs, pathAndQuery: manifestPath })
    const issuedResponse = await issueTransferManifest(new NextRequest(manifestRequest.url, {
      method: manifestRequest.init.method, headers: manifestRequest.init.headers }), context)
    expect(issuedResponse.status).toBe(200)
    const issued = await issuedResponse.json()
    expect(issued.issueId).toBe(response.headers.get('x-edocbr-transfer-issue-id'))
    const storedIssue = await db.localSessionTransferIssue.findUniqueOrThrow({ where: { id: issued.issueId } })
    expect(storedIssue.manifestJson).toBe(canonicalManifest(candidate.manifest))
    const firstArtifact = candidate.manifest.artifacts[0]
    const artifactPath = `/api/v1/sessions/${session.id}/transfer-artifacts/${encodeURIComponent(firstArtifact.id)}` +
      `?issueId=${encodeURIComponent(issued.issueId)}`
    const artifactRequest = signedLocalDeviceGet({ ...clientArgs, pathAndQuery: artifactPath })
    const artifactResponse = await downloadTransferArtifact(new NextRequest(artifactRequest.url, {
      method: artifactRequest.init.method, headers: artifactRequest.init.headers }),
    { params: Promise.resolve({ id: session.id, artifactId: firstArtifact.id }) })
    expect(artifactResponse.status).toBe(200)
    expect(Buffer.from(await artifactResponse.arrayBuffer())).toEqual(Buffer.from(candidate.bytesById.get(firstArtifact.id)!))
    const alienArtifactRequest = signedLocalDeviceGet({ ...clientArgs, tenantId: other.id,
      pathAndQuery: artifactPath })
    expect((await downloadTransferArtifact(new NextRequest(alienArtifactRequest.url, {
      method: alienArtifactRequest.init.method, headers: alienArtifactRequest.init.headers }),
    { params: Promise.resolve({ id: session.id, artifactId: firstArtifact.id }) })).status).toBe(401)
    const selectedResponse = async (artifactId: string) => {
      const pathAndQuery = `/api/v1/sessions/${session.id}/transfer-artifacts/${encodeURIComponent(artifactId)}` +
        `?issueId=${encodeURIComponent(issued.issueId)}`
      const signed = signedLocalDeviceGet({ ...clientArgs, pathAndQuery })
      return downloadTransferArtifact(new NextRequest(signed.url, {
        method: signed.init.method, headers: signed.init.headers }),
      { params: Promise.resolve({ id: session.id, artifactId }) })
    }
    const frozenAttachment = await db.sessionMatterArtifact.findFirstOrThrow({ where: {
      revisionId: candidate.manifest.revisionId, attachmentId: attachment.id } })
    await db.sessionMatterArtifact.update({ where: { id: frozenAttachment.id },
      data: { content: Buffer.from('bytes adulterados') } })
    expect((await selectedResponse(firstArtifact.id)).status).toBe(200)
    expect((await selectedResponse(candidate.manifest.artifacts[1].id)).status).toBe(409)
    await db.sessionMatterArtifact.update({ where: { id: frozenAttachment.id },
      data: { content: Buffer.from(candidate.bytesById.get(candidate.manifest.artifacts[1].id)!) } })
    await db.localSessionTransferIssue.update({ where: { id: issued.issueId }, data: { manifestJson: '{}' } })
    expect((await selectedResponse(firstArtifact.id)).status).toBe(409)
    await db.localSessionTransferIssue.update({ where: { id: issued.issueId }, data: { manifestJson: null } })
    expect((await selectedResponse(firstArtifact.id)).status).toBe(200)
    await db.localSessionTransferIssue.update({ where: { id: issued.issueId },
      data: { manifestJson: storedIssue.manifestJson } })
    const unknownIssue = signedLocalDeviceGet({ ...clientArgs,
      pathAndQuery: artifactPath.replace(issued.issueId, 'unknown') })
    expect((await downloadTransferArtifact(new NextRequest(unknownIssue.url, {
      method: unknownIssue.init.method, headers: unknownIssue.init.headers }),
    { params: Promise.resolve({ id: session.id, artifactId: firstArtifact.id }) })).status).toBe(404)
    expect((await listLocalPreparations(new NextRequest('https://example.invalid/api/v1/local-preparations'),
      { params: Promise.resolve({}) })).status).toBe(401)
    await expect(downloadAndPrepareSession(clientArgs)).rejects.toThrow('truncado')
    await expect(readPreparedPackage({ root: clientRoot, expectedTenantId: tenant.id,
      expectedSessionId: session.id, trustedKeys })).rejects.toThrow('não preparada')
    expect(artifactDownloads.get(candidate.manifest.artifacts[0].id)).toBe(1)
    await expect(downloadAndPrepareSession(clientArgs)).rejects.toThrow('diverge do manifesto')
    expect(artifactDownloads.get(candidate.manifest.artifacts[0].id)).toBe(1)
    await expect(readPreparedPackage({ root: clientRoot, expectedTenantId: tenant.id,
      expectedSessionId: session.id, trustedKeys })).rejects.toThrow('não preparada')
    await expect(downloadAndPrepareSession(clientArgs)).rejects.toThrow('importado, mas confirmação recusada')
    expect(artifactDownloads.get(candidate.manifest.artifacts[0].id)).toBe(1)
    expect(artifactDownloads.get(candidate.manifest.artifacts[1].id)).toBe(3)
    expect((await readPreparedPackage({ root: clientRoot, expectedTenantId: tenant.id,
      expectedSessionId: session.id, trustedKeys })).manifest.revisionId).toBe(candidate.manifest.revisionId)
    const unacknowledged = await db.localSessionTransferIssue.findFirstOrThrow({ where: {
      tenantId: tenant.id, deviceId: device.id, sessionId: session.id } })
    expect(unacknowledged.acknowledgedAt).toBeNull()
    const ownStatus = signedLocalDeviceGet({ ...clientArgs, pathAndQuery:
      `/api/v1/sessions/${session.id}/transfer-status?revisionId=${unacknowledged.revisionId}&manifestSha256=${unacknowledged.manifestSha256}` })
    const statusResponse = await transferStatus(new NextRequest(ownStatus.url, {
      method: ownStatus.init.method, headers: ownStatus.init.headers }), context)
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json()).acknowledgedAt).toBeNull()
    const alienStatus = signedLocalDeviceGet({ ...clientArgs, pathAndQuery:
      `/api/v1/sessions/${session.id}/transfer-status?revisionId=other&manifestSha256=${unacknowledged.manifestSha256}` })
    expect((await transferStatus(new NextRequest(alienStatus.url, {
      method: alienStatus.init.method, headers: alienStatus.init.headers }), context)).status).toBe(404)
    expect(transferDownloads).toBe(3)
    const recovered = await synchronizePreparedSessions(clientArgs)
    expect(recovered.failed).toHaveLength(0)
    expect(recovered.prepared).toHaveLength(1)
    expect(transferDownloads).toBe(3)
    const imported = recovered.prepared[0]
    expect(imported.revisionId).toBe(candidate.manifest.revisionId)
    const firstIssue = await db.localSessionTransferIssue.findFirstOrThrow({ where: {
      tenantId: tenant.id, deviceId: device.id, sessionId: session.id } })
    expect(firstIssue.acknowledgedAt).not.toBeNull()
    const badReceipt = JSON.stringify({ issueId: firstIssue.id, revisionId: firstIssue.revisionId,
      revisionNumber: firstIssue.revisionNumber, manifestSha256: '0'.repeat(64),
      artifacts: JSON.parse(firstIssue.artifactHashesJson) })
    const badSigned = signedLocalDevicePost({ ...clientArgs, body: badReceipt,
      pathAndQuery: `/api/v1/sessions/${session.id}/transfer-ack` })
    const ackRequest = (body: string, headers: HeadersInit) => new NextRequest(badSigned.url, {
      method: 'POST', headers, body })
    expect((await acknowledgeTransfer(ackRequest(badReceipt, badSigned.init.headers!), context)).status).toBe(409)
    expect((await acknowledgeTransfer(ackRequest(badReceipt.replace('0'.repeat(64), '1'.repeat(64)),
      badSigned.init.headers!), context)).status).toBe(401)
    expect((await synchronizePreparedSessions(clientArgs)).prepared[0].manifestSha256).toBe(imported.manifestSha256)
    expect(transferDownloads).toBe(3)
    expect(await db.localSessionTransferIssue.count({ where: { tenantId: tenant.id,
      deviceId: device.id, sessionId: session.id } })).toBe(1)
    await expect(downloadAndPrepareSession({ ...clientArgs, baseUrl: 'http://example.invalid' })).rejects.toThrow('HTTPS')
    await expect(downloadAndPrepareSession({ ...clientArgs,
      trustedKeys: new Map([['other', generateKeyPairSync('ed25519').publicKey]]) })).rejects.toThrow('confiável')
    await db.session.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
      tenantId: tenant.id, number: index + 2, year: 2026,
      scheduledAt: new Date('2026-12-01T12:00:00Z'), status: 'scheduled', agendaPublished: true,
      presidentId: person.id,
    })) })
    const otherSession = await db.session.create({ data: { tenantId: other.id, number: 1, year: 2026,
      scheduledAt: new Date('2026-12-01T12:00:00Z'), status: 'scheduled', agendaPublished: true } })
    const alienCursor = signedLocalDeviceGet({ ...clientArgs,
      pathAndQuery: `/api/v1/local-preparations?cursor=${otherSession.id}` })
    expect((await listLocalPreparations(new NextRequest(alienCursor.url, {
      method: alienCursor.init.method, headers: alienCursor.init.headers }),
    { params: Promise.resolve({}) })).status).toBe(404)
    const discovered = await discoverPreparedSessions(clientArgs)
    expect(discovered).toHaveLength(102)
    expect(discovered.filter((item) => item.readyForTransfer).map((item) => item.id)).toEqual([session.id])
    const beforeCycleDownloads = transferDownloads
    const cycle = await synchronizePreparedSessions(clientArgs)
    expect(cycle.prepared).toHaveLength(1)
    expect(cycle.skipped).toHaveLength(101)
    expect(cycle.failed).toHaveLength(0)
    expect(transferDownloads).toBe(beforeCycleDownloads)
  } finally { await rm(clientRoot, { recursive: true, force: true }) }
  const quotaPlan = await db.plan.create({ data: { name: 'transfer-quota-ensaios',
    limits: JSON.stringify({ maxTransferPackageMiB: 1 }) } })
  await db.subscription.create({ data: { tenantId: tenant.id, planId: quotaPlan.id, status: 'active' } })
  const largePdf = Buffer.alloc(1024 * 1024 + 128, 0x41)
  const largeHash = hash(largePdf)
  try {
    await db.sessionDocument.update({ where: { id: document.id }, data: {
      content: largePdf, sizeBytes: largePdf.length, sha256: largeHash } })
    const references = JSON.parse(revision.documentManifestJson) as Array<Record<string, unknown>>
    references[0].sizeBytes = largePdf.length
    references[0].sha256 = largeHash
    await db.sessionAgendaRevision.update({ where: { id: revision.id },
      data: { documentManifestJson: JSON.stringify(references) } })
    await expect(issueSessionTransfer({ tenantId: tenant.id, sessionId: session.id,
      deviceId: device.id })).rejects.toMatchObject({ code: 'PLAN_LIMIT', status: 402 })
    await db.plan.update({ where: { id: quotaPlan.id },
      data: { limits: JSON.stringify({ maxTransferPackageMiB: 2 }) } })
    expect((await issueSessionTransfer({ tenantId: tenant.id, sessionId: session.id,
      deviceId: device.id })).manifest.artifacts[0].sizeBytes).toBe(largePdf.length)
  } finally {
    await db.sessionDocument.update({ where: { id: document.id }, data: {
      content, sizeBytes: content.length, sha256: hash(content) } })
    await db.sessionAgendaRevision.update({ where: { id: revision.id },
      data: { documentManifestJson: revision.documentManifestJson } })
  }
  expect((await downloadTransfer(signedRequest, context)).status).toBe(409)
  const revoked = request(tenant.id)
  await db.localServerDesignation.update({ where: { tenantId: tenant.id }, data: { deviceId: null } })
  expect((await downloadTransfer(revoked, context)).status).toBe(401)
  delete process.env.EDOCBR_TRANSFER_KEY_ROOT
})

test('edições posteriores não mudam revisão publicada; fontes inseguras ficam indisponíveis em revisão nova', async () => {
  const original = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })
  const parliamentarian = await db.parliamentarian.findFirstOrThrow({ where: { tenantId: ids.tenant } })
  await db.parliamentarian.update({ where: { id: parliamentarian.id }, data: { name: 'Nome posterior', party: 'ZZZ', active: false } })
  await db.tenant.update({ where: { id: ids.tenant }, data: { settings: JSON.stringify({ quorumMinimum: 99 }) } })
  await db.session.update({ where: { id: ids.session }, data: { version: { increment: 1 } } })
  await db.matterVersion.create({ data: { matterId: ids.matter, version: 2, text: 'Texto posterior', authorName: 'Autora' } })
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: 'https://example.invalid/anexo.pdf' } })
  let capture = await db.$transaction((tx) => captureMatterSnapshot(tx, { tenantId: ids.tenant,
    agenda: [{ matterId: ids.matter }], publicRoot }))
  expect(capture.manifest.unavailableAttachmentIds).toEqual([ids.attachment])
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: `/tenants/${ids.other}/anexo.pdf` } })
  capture = await db.$transaction((tx) => captureMatterSnapshot(tx, { tenantId: ids.tenant,
    agenda: [{ matterId: ids.matter }], publicRoot }))
  expect(capture.manifest.unavailableAttachmentIds).toEqual([ids.attachment])
  await symlink(join(publicRoot, 'tenants', ids.tenant, 'anexo.pdf'), join(publicRoot, 'tenants', ids.tenant, 'link.pdf'))
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: `/tenants/${ids.tenant}/link.pdf` } })
  capture = await db.$transaction((tx) => captureMatterSnapshot(tx, { tenantId: ids.tenant,
    agenda: [{ matterId: ids.matter }], publicRoot }))
  expect(capture.manifest.unavailableAttachmentIds).toEqual([ids.attachment])
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: `/tenants/${ids.tenant}/anexo.pdf` } })
  const stable = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })
  expect(canonicalManifest(stable.manifest)).toBe(canonicalManifest(original.manifest))
  expect(stable.manifest.matterSnapshot[0].latestText).toBe('Texto integral de ensaio')
  expect(stable.bytesById.get(`matter-attachment:${ids.attachment}`)).toEqual(original.bytesById.get(`matter-attachment:${ids.attachment}`))
  const revision = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: ids.session, revision: 1 } })
  await db.sessionAgendaRevision.update({ where: { id: revision.id }, data: { transferContextJson: null } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('Revisão legada sem contexto')
  await db.sessionAgendaRevision.update({ where: { id: revision.id }, data: { transferContextJson: revision.transferContextJson } })
  await db.sessionAgendaRevision.update({ where: { id: revision.id }, data: { matterManifestJson: null } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('Revisão legada')
  await db.sessionAgendaRevision.update({ where: { id: revision.id }, data: { matterManifestJson: JSON.stringify({ version: 1,
    matters: JSON.parse(revision.matterManifestJson!).matters, unavailableAttachmentIds: [ids.attachment] }) } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('sem bytes verificáveis')
  await db.sessionAgendaRevision.update({ where: { id: revision.id }, data: { matterManifestJson: revision.matterManifestJson } })
  const artifact = await db.sessionMatterArtifact.findFirstOrThrow({ where: { attachmentId: ids.attachment } })
  await db.sessionMatterArtifact.update({ where: { id: artifact.id }, data: { content: Buffer.from('alterado') } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('hash divergente')
  await db.sessionMatterArtifact.update({ where: { id: artifact.id }, data: { content: Buffer.from(original.bytesById.get(`matter-attachment:${ids.attachment}`)!) } })
  await db.sessionDocument.update({ where: { id: ids.document }, data: { mimeType: 'application/octet-stream' } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('diverge')
  await db.sessionDocument.update({ where: { id: ids.document }, data: { mimeType: 'application/pdf' } })
  await db.sessionDocument.update({ where: { id: ids.document }, data: { content: Buffer.from('alterado') } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('diverge')
})

test('sessão oficial usa configuração aprovada histórica, não settings alteradas depois', async () => {
  const snapshotJson = JSON.stringify({ tenant: { settings: JSON.stringify({ quorumMinimum: 4 }) },
    parliamentarians: [{ id: 'approved-member', name: 'Nome aprovado', active: true, party: 'BBB' }],
    boardPositions: [{ parliamentarianId: 'approved-member', status: 'confirmed', role: 'presidente' }] })
  const approved = await db.officialConfigurationRevision.create({ data: { tenantId: ids.tenant,
    version: 1, snapshotJson, snapshotSha256: hash(snapshotJson), approvalReference: 'teste',
    approvedById: 'tester', approvedByName: 'Pessoa teste' } })
  await db.session.update({ where: { id: ids.session }, data: { official: true, officialConfigurationId: approved.id } })
  const revision = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: ids.session, revision: 1 } })
  await db.sessionAgendaRevision.update({ where: { id: revision.id }, data: { transferContextJson: null } })
  await db.$transaction((tx) => freezeTransferContext(tx, { revisionId: revision.id, tenantId: ids.tenant, sessionId: ids.session }))
  await db.sessionDocument.update({ where: { id: ids.document }, data: {
    content: Buffer.from('%PDF-1.4\nPauta sintética\n%%EOF') } })
  const candidate = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })
  expect(candidate.manifest.deliberationPolicySnapshot.quorumMinimum).toBe(4)
  expect(candidate.manifest.rosterSnapshot[0].parliamentarianId).toBe('approved-member')
  expect(candidate.manifest.officialConfigurationId).toBe(approved.id)
})

test('exportador escolhe a última revisão publicada e não mistura documento antigo', async () => {
  const content = Buffer.from('%PDF-1.4\nPauta revisada\n%%EOF')
  const document = await db.sessionDocument.create({ data: { tenantId: ids.tenant, sessionId: ids.session,
    kind: 'pauta', version: 2, name: 'Pauta-v2.pdf', sizeBytes: content.length, sha256: hash(content),
    content, createdById: 'tester' } })
  const revision = await db.sessionAgendaRevision.create({ data: { tenantId: ids.tenant, sessionId: ids.session, revision: 2,
    agendaJson: JSON.stringify([{ id: 'agenda-v2', order: 0, matterId: ids.matter, title: 'Pauta revisada' }]),
    policyJson: JSON.stringify({ minimumAgendaMatters: 1 }),
    documentManifestJson: JSON.stringify([{ id: document.id, kind: document.kind, version: document.version,
      name: document.name, mimeType: document.mimeType, sizeBytes: document.sizeBytes, sha256: document.sha256 }]) } })
  await db.$transaction(async (tx) => {
    await freezeMatterSnapshot(tx, { revisionId: revision.id, tenantId: ids.tenant,
      agenda: [{ matterId: ids.matter }], publicRoot })
    await freezeTransferContext(tx, { revisionId: revision.id, tenantId: ids.tenant, sessionId: ids.session })
  })
  const candidate = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })
  expect(candidate.manifest.revisionNumber).toBe(2)
  expect(candidate.manifest.artifacts.some((item) => item.sourceId === ids.document)).toBe(false)
  expect(candidate.manifest.artifacts.some((item) => item.sourceId === document.id)).toBe(true)
  await db.session.update({ where: { id: ids.session }, data: { status: 'open' } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('ainda não aberta')
})
