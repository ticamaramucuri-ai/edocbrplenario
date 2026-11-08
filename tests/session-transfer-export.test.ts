import { afterAll, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { buildSessionTransferCandidate } from '@/lib/server/session-transfer-export'
import { captureMatterSnapshot, freezeMatterSnapshot } from '@/lib/server/session-matter-snapshot'
import { signPreparedPackage, verifyPreparedPackage } from '@/lib/session-transfer-contract'
import { importPreparedPackage, readPreparedPackage } from '@/lib/local-session-package-store'
import { GET as downloadTransfer } from '@/app/api/v1/sessions/[id]/transfer/route'
import { localDeviceRequestMessage } from '@/lib/server/local-device-identity'
import { provisionTransferSigningKey } from '@/lib/server/session-transfer-signing'
import { readTransferPackage } from '@/lib/session-transfer-wire'
import { downloadAndPrepareSession } from '@/lib/local-device-client'
import { GET as listLocalPreparations } from '@/app/api/v1/local-preparations/route'
import { discoverPreparedSessions, synchronizePreparedSessions } from '@/lib/local-session-discovery'
import { signedLocalDeviceGet } from '@/lib/local-device-http'

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
      name: document.name, sizeBytes: document.sizeBytes, sha256: document.sha256 }]) } })
  await db.$transaction((tx) => freezeMatterSnapshot(tx, { revisionId: revision.id, tenantId: tenant.id,
    agenda: [{ matterId: matter.id }], publicRoot }))
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
  const trustedKeys = new Map([[signing.active.keyId, (await import('node:crypto')).createPublicKey(signing.publicKeyPem)]])
  const wireLocalRoot = await mkdtemp(join(tmpdir(), 'edocbr-wire-import-'))
  try {
    await importPreparedPackage({ root: wireLocalRoot, ...wire,
      expectedTenantId: tenant.id, expectedSessionId: session.id, trustedKeys })
    expect((await readPreparedPackage({ root: wireLocalRoot, expectedTenantId: tenant.id,
      expectedSessionId: session.id, trustedKeys })).manifest.revisionId).toBe(candidate.manifest.revisionId)
  } finally { await rm(wireLocalRoot, { recursive: true, force: true }) }
  const clientRoot = await mkdtemp(join(tmpdir(), 'edocbr-client-import-'))
  const routeFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new NextRequest(String(input), { method: init?.method, headers: init?.headers })
    return new URL(request.url).pathname === '/api/v1/local-preparations'
      ? listLocalPreparations(request, { params: Promise.resolve({}) })
      : downloadTransfer(request, context)
  }) as typeof fetch
  const clientArgs = { baseUrl: 'https://example.invalid', tenantId: tenant.id, sessionId: session.id,
    deviceId: device.id, privateKey: deviceKeys.privateKey, trustedKeys, localRoot: clientRoot,
    fetchImpl: routeFetch }
  try {
    expect((await listLocalPreparations(new NextRequest('https://example.invalid/api/v1/local-preparations'),
      { params: Promise.resolve({}) })).status).toBe(401)
    const imported = await downloadAndPrepareSession(clientArgs)
    expect(imported.revisionId).toBe(candidate.manifest.revisionId)
    expect((await downloadAndPrepareSession(clientArgs)).manifestSha256).toBe(imported.manifestSha256)
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
    const cycle = await synchronizePreparedSessions(clientArgs)
    expect(cycle.prepared).toHaveLength(1)
    expect(cycle.skipped).toHaveLength(101)
    expect(cycle.failed).toHaveLength(0)
  } finally { await rm(clientRoot, { recursive: true, force: true }) }
  expect((await downloadTransfer(signedRequest, context)).status).toBe(409)
  const revoked = request(tenant.id)
  await db.localServerDesignation.update({ where: { tenantId: tenant.id }, data: { deviceId: null } })
  expect((await downloadTransfer(revoked, context)).status).toBe(401)
  delete process.env.EDOCBR_TRANSFER_KEY_ROOT
})

test('edições posteriores não mudam revisão publicada; fontes inseguras ficam indisponíveis em revisão nova', async () => {
  const original = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })
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
  expect(stable.manifest.matterSnapshot[0].latestText).toBe('Texto integral de ensaio')
  expect(stable.bytesById.get(`matter-attachment:${ids.attachment}`)).toEqual(original.bytesById.get(`matter-attachment:${ids.attachment}`))
  const revision = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: ids.session, revision: 1 } })
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
      name: document.name, sizeBytes: document.sizeBytes, sha256: document.sha256 }]) } })
  await db.$transaction((tx) => freezeMatterSnapshot(tx, { revisionId: revision.id, tenantId: ids.tenant,
    agenda: [{ matterId: ids.matter }], publicRoot }))
  const candidate = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })
  expect(candidate.manifest.revisionNumber).toBe(2)
  expect(candidate.manifest.artifacts.some((item) => item.sourceId === ids.document)).toBe(false)
  expect(candidate.manifest.artifacts.some((item) => item.sourceId === document.id)).toBe(true)
  await db.session.update({ where: { id: ids.session }, data: { status: 'open' } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session })).rejects.toThrow('ainda não aberta')
})
