import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { signPreparedPackage, verifyPreparedPackage, type TransferManifestV1 } from '@/lib/session-transfer-contract'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const document = Buffer.from('%PDF-1.4\nsynthetic session agenda\n')
const attachment = Buffer.from('synthetic matter attachment')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function fixture() {
  const manifest: TransferManifestV1 = {
    format: 'edocbr.session-transfer', schemaVersion: 1,
    tenantId: 'tenant-a', sessionId: 'session-a', revisionId: 'revision-2',
    revisionNumber: 2, sessionVersion: 4, officialConfigurationId: 'policy-1',
    createdAt: '2026-11-07T12:00:00.000Z',
    agendaSnapshot: [{ id: 'agenda-1', order: 1, matterId: 'matter-1', title: 'Projeto sintético' }],
    policySnapshot: { minimumAgendaMatters: 1, quorum: 7 },
    deliberationPolicySnapshot: { quorum: 7, majority: 'simples', secretBallotEnabled: false },
    matterSnapshot: [{ matterId: 'matter-1', type: 'projeto_de_lei', number: 1, year: 2026,
      ementa: 'Projeto sintético', authors: ['Pessoa Teste'], latestVersion: 1, latestText: 'Texto sintético' }],
    rosterSnapshot: [{ parliamentarianId: 'member-1', displayName: 'Pessoa Teste', party: 'ABC', active: true, boardRole: 'presidente' }],
    artifacts: [
      { id: 'document-1', source: 'session_document', sourceId: 'document-1', name: 'Pauta.pdf', mimeType: 'application/pdf', sizeBytes: document.length, sha256: sha(document) },
      { id: 'attachment-1', source: 'matter_attachment', sourceId: 'attachment-1', name: 'Anexo.txt', mimeType: 'text/plain', sizeBytes: attachment.length, sha256: sha(attachment) },
    ],
  }
  const bytesById = new Map<string, Uint8Array>([['document-1', document], ['attachment-1', attachment]])
  const signature = signPreparedPackage(manifest, bytesById, 'staging-signing-key', privateKey)
  const verify = (changes: Partial<Parameters<typeof verifyPreparedPackage>[0]> = {}) => verifyPreparedPackage({
    manifest, signature, bytesById, expectedTenantId: 'tenant-a', expectedSessionId: 'session-a',
    minimumRevisionNumber: 2, trustedKeys: new Map([['staging-signing-key', publicKey]]), ...changes,
  })
  return { manifest, bytesById, signature, verify }
}

test('pacote íntegro e assinado prepara somente a Câmara, sessão e revisão designadas', () => {
  const { manifest, verify } = fixture()
  expect(verify()).toEqual(manifest)
  expect(() => verify({ expectedTenantId: 'tenant-b' })).toThrow('outra Câmara')
  expect(() => verify({ expectedSessionId: 'session-b' })).toThrow('outra Câmara')
  expect(() => verify({ minimumRevisionNumber: 3 })).toThrow('Revisão antiga')
  expect(() => verify({ expectedRevisionId: 'revision-3' })).toThrow('outra revisão')
  expect(() => verify({ trustedKeys: new Map() })).toThrow('chave confiável')
})

test('alteração de pauta, política ou assinatura é recusada', () => {
  const { manifest, signature, verify } = fixture()
  expect(() => verify({ manifest: { ...manifest, agendaSnapshot: [{ id: 'outro' }] } })).toThrow('Assinatura')
  expect(() => verify({ manifest: { ...manifest, policySnapshot: { quorum: 1 } } })).toThrow('Assinatura')
  expect(() => verify({ manifest: { ...manifest, deliberationPolicySnapshot: { quorum: 1 } } })).toThrow('Assinatura')
  expect(() => verify({ manifest: { ...manifest, matterSnapshot: [] } })).toThrow('Matéria referenciada')
  expect(() => verify({ signature: { ...signature, valueBase64: Buffer.alloc(64).toString('base64') } })).toThrow('Assinatura')
})

test('ordem das chaves JSON não altera a assinatura', () => {
  const { manifest, verify } = fixture()
  const reordered = Object.fromEntries(Object.entries(manifest).reverse()) as TransferManifestV1
  expect(verify({ manifest: reordered }).sessionId).toBe('session-a')
})

test('chave JSON especial não some da serialização assinada', () => {
  const { manifest, bytesById } = fixture()
  const policy = JSON.parse('{"__proto__":{"quorum":1},"minimumAgendaMatters":1}') as Record<string, unknown>
  const signed = signPreparedPackage({ ...manifest, policySnapshot: policy }, bytesById, 'staging-signing-key', privateKey)
  expect(signed.valueBase64).not.toBe(signPreparedPackage(manifest, bytesById, 'staging-signing-key', privateKey).valueBase64)
})

test('arquivo ausente, adulterado ou representado só por URL bloqueia prontidão', () => {
  const { manifest, bytesById, verify } = fixture()
  expect(() => verify({ bytesById: new Map([['document-1', document]]) })).toThrow('Quantidade')
  expect(() => verify({ bytesById: new Map([...bytesById, ['attachment-1', Buffer.from('alterado')]]) })).toThrow('tamanho divergente')
  const urlOnly = { ...manifest, artifacts: manifest.artifacts.map((item) => item.id === 'attachment-1'
    ? { ...item, url: 'https://example.invalid/anexo' } : item) }
  expect(() => signPreparedPackage(urlOnly, bytesById, 'staging-signing-key', privateKey)).toThrow()
})

test('identificadores duplicados ou bytes extras são recusados antes da assinatura', () => {
  const { manifest, bytesById } = fixture()
  expect(() => signPreparedPackage({ ...manifest, artifacts: [manifest.artifacts[0], manifest.artifacts[0]] }, bytesById, 'staging-signing-key', privateKey)).toThrow('duplicados')
  expect(() => signPreparedPackage(manifest, new Map([...bytesById, ['extra', Buffer.from('x')]]), 'staging-signing-key', privateKey)).toThrow('Quantidade')
})
