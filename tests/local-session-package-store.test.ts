import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importPreparedPackage, readPreparedPackage } from '@/lib/local-session-package-store'
import { signPreparedPackage, type TransferManifestV1 } from '@/lib/session-transfer-contract'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const segment = (value: string) => createHash('sha256').update(value).digest('hex')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const trustedKeys = new Map([['test-key', publicKey]])

function packageFor(revisionNumber: number, content = Buffer.from('PDF sintético')) {
  const manifest: TransferManifestV1 = {
    format: 'edocbr.session-transfer', schemaVersion: 1, tenantId: 'tenant-1', sessionId: 'session-1',
    revisionId: `revision-${revisionNumber}`, revisionNumber, sessionVersion: revisionNumber + 1,
    officialConfigurationId: null, createdAt: '2026-11-07T12:00:00.000Z',
    agendaSnapshot: [{ id: 'agenda-1', matterId: 'matter-1', title: 'Matéria sintética' }],
    policySnapshot: { minimumAgendaMatters: 1 }, deliberationPolicySnapshot: { quorumMinimum: 2 },
    matterSnapshot: [{ matterId: 'matter-1', type: 'projeto_de_lei', number: 1, year: 2026,
      ementa: 'Teste', authors: ['Autora'], latestVersion: 1, latestText: 'Texto integral' }],
    rosterSnapshot: [{ parliamentarianId: 'person-1', displayName: 'Presidência', party: 'ABC', active: true, boardRole: 'presidente' }],
    artifacts: [{ id: 'document:1', source: 'session_document', sourceId: '1', name: 'Pauta.pdf',
      mimeType: 'application/pdf', sizeBytes: content.length, sha256: hash(content) }],
  }
  const bytesById = new Map<string, Uint8Array>([['document:1', content]])
  const signature = signPreparedPackage(manifest, bytesById, 'test-key', privateKey)
  return { manifest, signature, bytesById }
}

test('importação atômica aceita revisão nova, repete a mesma e recusa regressão ou troca silenciosa', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-local-package-'))
  try {
    const first = packageFor(1)
    const args = { root, expectedTenantId: 'tenant-1', expectedSessionId: 'session-1', trustedKeys }
    const imported = await importPreparedPackage({ ...args, ...first })
    expect(imported.revisionNumber).toBe(1)
    expect((await readPreparedPackage(args)).bytesById.get('document:1')).toEqual(first.bytesById.get('document:1'))
    expect(await importPreparedPackage({ ...args, ...first })).toEqual(imported)
    const invalidNext = packageFor(2)
    await expect(importPreparedPackage({ ...args, ...invalidNext,
      bytesById: new Map([['document:1', Buffer.from('bytes incompletos')]]) })).rejects.toThrow('divergente')
    expect((await readPreparedPackage(args)).manifest.revisionNumber).toBe(1)
    const changedSameNumber = packageFor(1, Buffer.from('PDF substituído'))
    await expect(importPreparedPackage({ ...args, ...changedSameNumber })).rejects.toThrow('Mesmo número')
    const second = packageFor(2, Buffer.from('Pauta revisada'))
    expect((await importPreparedPackage({ ...args, ...second })).revisionNumber).toBe(2)
    await expect(importPreparedPackage({ ...args, ...first })).rejects.toThrow('Revisão antiga')
    expect((await readPreparedPackage(args)).manifest.revisionId).toBe('revision-2')
    await expect(readPreparedPackage({ ...args, expectedTenantId: 'tenant-2' })).rejects.toThrow('não preparada')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('arquivo adulterado e assinatura/chave alheia não produzem prontidão', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-local-package-'))
  try {
    const initial = packageFor(1)
    const args = { root, expectedTenantId: 'tenant-1', expectedSessionId: 'session-1', trustedKeys }
    await expect(importPreparedPackage({ ...args, ...initial,
      bytesById: new Map([['document:1', Buffer.from('adulterado')]]) })).rejects.toThrow('divergente')
    await expect(readPreparedPackage(args)).rejects.toThrow('não preparada')
    await expect(importPreparedPackage({ ...args, ...initial, trustedKeys: new Map() })).rejects.toThrow('chave confiável')
    await importPreparedPackage({ ...args, ...initial })
    const file = join(root, 'tenants', segment('tenant-1'), 'sessions', segment('session-1'),
      'revisions', `00000001-${segment('revision-1')}`, 'artifacts', '000000.bin')
    const original = await readFile(file)
    await writeFile(file, Buffer.from('alterado'))
    await expect(readPreparedPackage(args)).rejects.toThrow('divergente')
    await expect(importPreparedPackage({ ...args, ...initial })).rejects.toThrow('divergente')
    await writeFile(file, original)
    expect((await readPreparedPackage(args)).prepared.revisionNumber).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('trava persistente impede segunda importação até recuperação manual', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-local-package-'))
  try {
    const session = join(root, 'tenants', segment('tenant-1'), 'sessions', segment('session-1'))
    await mkdir(join(session, '.import-lock'), { recursive: true })
    await expect(importPreparedPackage({ root, ...packageFor(1), expectedTenantId: 'tenant-1',
      expectedSessionId: 'session-1', trustedKeys })).rejects.toThrow('recuperação manual')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reimportação recompõe diretório órfão deixado antes da troca do ponteiro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-local-package-'))
  try {
    const args = { root, expectedTenantId: 'tenant-1', expectedSessionId: 'session-1', trustedKeys }
    await importPreparedPackage({ ...args, ...packageFor(1) })
    const orphan = join(root, 'tenants', segment('tenant-1'), 'sessions', segment('session-1'),
      'revisions', `00000002-${segment('revision-2')}`)
    await mkdir(orphan)
    await writeFile(join(orphan, 'partial'), 'interrompido')
    const next = packageFor(2)
    expect((await importPreparedPackage({ ...args, ...next })).revisionNumber).toBe(2)
    expect((await readPreparedPackage(args)).bytesById.get('document:1')).toEqual(next.bytesById.get('document:1'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
