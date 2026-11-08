import { expect, test } from 'bun:test'
import { createHash, createPublicKey } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importPreparedPackage, readPreparedPackage } from '@/lib/local-session-package-store'
import { verifyPreparedPackage, type TransferManifestV1 } from '@/lib/session-transfer-contract'
import { loadActiveTransferSigningKey, provisionTransferSigningKey, signSessionTransferCandidate } from '@/lib/server/session-transfer-signing'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const segment = (value: string) => createHash('sha256').update(value).digest('hex')

function candidate(tenantId: string, revisionNumber: number) {
  const bytes = Buffer.from(`PDF fictício revisão ${revisionNumber}`)
  const manifest: TransferManifestV1 = {
    format: 'edocbr.session-transfer', schemaVersion: 1, tenantId, sessionId: 'session-1',
    revisionId: `revision-${revisionNumber}`, revisionNumber, sessionVersion: revisionNumber + 1,
    officialConfigurationId: null, createdAt: '2026-11-07T12:00:00.000Z',
    agendaSnapshot: [{ id: 'item-1', matterId: 'matter-1' }], policySnapshot: { minimumAgendaMatters: 1 },
    deliberationPolicySnapshot: { quorumMinimum: 1 },
    matterSnapshot: [{ matterId: 'matter-1', type: 'projeto_de_lei', number: 1, year: 2026,
      ementa: 'Teste', authors: ['Autora'], latestVersion: 1, latestText: 'Texto' }],
    rosterSnapshot: [{ parliamentarianId: 'person-1', displayName: 'Pessoa', party: 'ABC', active: true, boardRole: null }],
    artifacts: [{ id: 'document-1', source: 'session_document', sourceId: 'document-1', name: 'Pauta.pdf',
      mimeType: 'application/pdf', sizeBytes: bytes.length, sha256: hash(bytes) }],
  }
  return { manifest, bytesById: new Map<string, Uint8Array>([['document-1', bytes]]) }
}

test('chave por Câmara assina candidato, rotação preserva confiança explícita e importação valida os bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-transfer-keys-'))
  const localRoot = await mkdtemp(join(tmpdir(), 'edocbr-signed-import-'))
  try {
    const first = await provisionTransferSigningKey({ root, tenantId: 'tenant-a' })
    const other = await provisionTransferSigningKey({ root, tenantId: 'tenant-b' })
    expect(first.active.keyId).not.toBe(other.active.keyId)
    const prepared = candidate('tenant-a', 1)
    const signed = await signSessionTransferCandidate({ root, tenantId: 'tenant-a', ...prepared })
    const keys = new Map([[first.active.keyId, createPublicKey(first.publicKeyPem)]])
    expect(verifyPreparedPackage({ ...prepared, signature: signed.signature, expectedTenantId: 'tenant-a',
      expectedSessionId: 'session-1', minimumRevisionNumber: 1, trustedKeys: keys }).revisionId).toBe('revision-1')
    expect(signed.publicKeySpkiSha256).toBe(first.active.publicKeySpkiSha256)
    await expect(signSessionTransferCandidate({ root, tenantId: 'tenant-b', ...prepared })).rejects.toThrow('outra Câmara')
    const stored = await importPreparedPackage({ root: localRoot, ...prepared, signature: signed.signature,
      expectedTenantId: 'tenant-a', expectedSessionId: 'session-1', trustedKeys: keys })
    expect(stored.revisionNumber).toBe(1)
    expect((await readPreparedPackage({ root: localRoot, expectedTenantId: 'tenant-a',
      expectedSessionId: 'session-1', trustedKeys: keys })).manifest.revisionId).toBe('revision-1')
    const rotated = await provisionTransferSigningKey({ root, tenantId: 'tenant-a' })
    expect(rotated.active.keyId).not.toBe(first.active.keyId)
    const second = candidate('tenant-a', 2)
    const newSignature = await signSessionTransferCandidate({ root, tenantId: 'tenant-a', ...second })
    await expect(importPreparedPackage({ root: localRoot, ...second, signature: newSignature.signature,
      expectedTenantId: 'tenant-a', expectedSessionId: 'session-1', trustedKeys: keys })).rejects.toThrow('chave confiável')
    keys.set(rotated.active.keyId, createPublicKey(rotated.publicKeyPem))
    expect((await importPreparedPackage({ root: localRoot, ...second, signature: newSignature.signature,
      expectedTenantId: 'tenant-a', expectedSessionId: 'session-1', trustedKeys: keys })).revisionNumber).toBe(2)
  } finally { await rm(root, { recursive: true, force: true }); await rm(localRoot, { recursive: true, force: true }) }
})

test('permissões abertas, symlink e impressão pública divergente bloqueiam assinatura', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-transfer-keys-'))
  try {
    const { active } = await provisionTransferSigningKey({ root, tenantId: 'tenant-a' })
    const tenantPath = join(root, 'tenants', segment('tenant-a'))
    const privatePath = join(tenantPath, `${active.keyId}.pem`)
    await chmod(privatePath, 0o644)
    await expect(loadActiveTransferSigningKey({ root, tenantId: 'tenant-a' })).rejects.toThrow('inseguro')
    await chmod(privatePath, 0o600)
    const backup = join(tenantPath, 'private-backup.pem')
    await writeFile(backup, await readFile(privatePath), { mode: 0o600 })
    await rm(privatePath)
    await symlink(backup, privatePath)
    await expect(loadActiveTransferSigningKey({ root, tenantId: 'tenant-a' })).rejects.toThrow('inseguro')
    await rm(privatePath)
    await writeFile(privatePath, await readFile(backup), { mode: 0o600 })
    const pointer = join(tenantPath, 'active.json')
    await writeFile(pointer, JSON.stringify({ ...active, publicKeySpkiSha256: '0'.repeat(64) }))
    await expect(loadActiveTransferSigningKey({ root, tenantId: 'tenant-a' })).rejects.toThrow('diverge')
  } finally { await rm(root, { recursive: true, force: true }) }
})
