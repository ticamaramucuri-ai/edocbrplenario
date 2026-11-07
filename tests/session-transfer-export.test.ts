import { afterAll, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { buildSessionTransferCandidate } from '@/lib/server/session-transfer-export'
import { signPreparedPackage, verifyPreparedPackage } from '@/lib/session-transfer-contract'

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
let publicRoot: string
let ids: { tenant: string; other: string; session: string; matter: string; attachment: string; document: string }

afterAll(async () => {
  await db.$disconnect()
  if (publicRoot) await rm(publicRoot, { recursive: true, force: true })
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
  await db.sessionAgendaRevision.create({ data: { tenantId: tenant.id, sessionId: session.id, revision: 1,
    agendaJson: JSON.stringify([{ id: agenda.id, order: 0, matterId: matter.id, title: agenda.title }]),
    policyJson: JSON.stringify({ minimumAgendaMatters: 1 }),
    documentManifestJson: JSON.stringify([{ id: document.id, kind: document.kind, version: document.version,
      name: document.name, sizeBytes: document.sizeBytes, sha256: document.sha256 }]) } })
  ids = { tenant: tenant.id, other: other.id, session: session.id, matter: matter.id,
    attachment: attachment.id, document: document.id }

  const candidate = await buildSessionTransferCandidate({ tenantId: tenant.id, sessionId: session.id, publicRoot })
  expect(candidate.manifest.artifacts).toHaveLength(2)
  expect(candidate.manifest.matterSnapshot[0].latestText).toBe('Texto integral de ensaio')
  expect(candidate.manifest.deliberationPolicySnapshot.quorumMinimum).toBe(3)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signature = signPreparedPackage(candidate.manifest, candidate.bytesById, 'test-key', privateKey)
  expect(verifyPreparedPackage({ manifest: candidate.manifest, signature,
    bytesById: candidate.bytesById, expectedTenantId: tenant.id, expectedSessionId: session.id,
    minimumRevisionNumber: 1, trustedKeys: new Map([['test-key', publicKey]]) }).revisionNumber).toBe(1)
  await expect(buildSessionTransferCandidate({ tenantId: other.id, sessionId: session.id, publicRoot })).rejects.toThrow('não encontrada')
})

test('anexo externo e divergência de PDF publicado bloqueiam exportação', async () => {
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: 'https://example.invalid/anexo.pdf' } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })).rejects.toThrow('URL externa')
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: `/tenants/${ids.other}/anexo.pdf` } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })).rejects.toThrow('desta Câmara')
  await symlink(join(publicRoot, 'tenants', ids.tenant, 'anexo.pdf'), join(publicRoot, 'tenants', ids.tenant, 'link.pdf'))
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: `/tenants/${ids.tenant}/link.pdf` } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })).rejects.toThrow('Symlink')
  await db.matterAttachment.update({ where: { id: ids.attachment }, data: { url: `/tenants/${ids.tenant}/anexo.pdf` } })
  await db.sessionDocument.update({ where: { id: ids.document }, data: { content: Buffer.from('alterado') } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })).rejects.toThrow('diverge')
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
  const candidate = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })
  expect(candidate.manifest.deliberationPolicySnapshot.quorumMinimum).toBe(4)
  expect(candidate.manifest.rosterSnapshot[0].parliamentarianId).toBe('approved-member')
  expect(candidate.manifest.officialConfigurationId).toBe(approved.id)
})

test('exportador escolhe a última revisão publicada e não mistura documento antigo', async () => {
  const content = Buffer.from('%PDF-1.4\nPauta revisada\n%%EOF')
  const document = await db.sessionDocument.create({ data: { tenantId: ids.tenant, sessionId: ids.session,
    kind: 'pauta', version: 2, name: 'Pauta-v2.pdf', sizeBytes: content.length, sha256: hash(content),
    content, createdById: 'tester' } })
  await db.sessionAgendaRevision.create({ data: { tenantId: ids.tenant, sessionId: ids.session, revision: 2,
    agendaJson: JSON.stringify([{ id: 'agenda-v2', order: 0, matterId: ids.matter, title: 'Pauta revisada' }]),
    policyJson: JSON.stringify({ minimumAgendaMatters: 1 }),
    documentManifestJson: JSON.stringify([{ id: document.id, kind: document.kind, version: document.version,
      name: document.name, sizeBytes: document.sizeBytes, sha256: document.sha256 }]) } })
  const candidate = await buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })
  expect(candidate.manifest.revisionNumber).toBe(2)
  expect(candidate.manifest.artifacts.some((item) => item.sourceId === ids.document)).toBe(false)
  expect(candidate.manifest.artifacts.some((item) => item.sourceId === document.id)).toBe(true)
  await db.session.update({ where: { id: ids.session }, data: { status: 'open' } })
  await expect(buildSessionTransferCandidate({ tenantId: ids.tenant, sessionId: ids.session, publicRoot })).rejects.toThrow('ainda não aberta')
})
