import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importPreparedPackage } from '@/lib/local-session-package-store'
import { readLocalSessionSummary } from '@/lib/local-session-summary'
import { signPreparedPackage, type TransferManifestV1 } from '@/lib/session-transfer-contract'

test('resumo local deriva pauta e documentos de pacote assinado e íntegro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-local-summary-'))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const trustedKeys = new Map([['test-key', publicKey]])
  const bytes = Buffer.from('PDF de ensaio')
  const manifest: TransferManifestV1 = { format: 'edocbr.session-transfer', schemaVersion: 1,
    tenantId: 'camara-a', sessionId: 'sessao-27', revisionId: 'rev-4', revisionNumber: 4,
    sessionVersion: 2, officialConfigurationId: null, createdAt: '2026-11-11T14:32:00.000Z',
    agendaSnapshot: [{ id: 'item-1', order: 1, title: 'Projeto de Lei 18/2026', matterId: 'matter-1' }],
    policySnapshot: {}, deliberationPolicySnapshot: { quorumMinimum: 7 },
    matterSnapshot: [{ matterId: 'matter-1', type: 'projeto_de_lei', number: 18, year: 2026,
      ementa: 'Calendário cultural', authors: ['Autora'], latestVersion: 1, latestText: 'Texto' }],
    rosterSnapshot: [{ parliamentarianId: 'p-1', displayName: 'Ana', party: 'A', active: true, boardRole: null }],
    artifacts: [{ id: 'pdf-1', source: 'session_document', sourceId: 'doc-1',
      name: 'Parecer.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }],
  }
  try {
    await importPreparedPackage({ root, manifest, signature: signPreparedPackage(manifest,
      new Map([['pdf-1', bytes]]), 'test-key', privateKey), bytesById: new Map([['pdf-1', bytes]]),
      expectedTenantId: 'camara-a', expectedSessionId: 'sessao-27', trustedKeys })
    expect(await readLocalSessionSummary({ root, tenantId: 'camara-a', sessionId: 'sessao-27', trustedKeys }))
      .toMatchObject({ sessionId: 'sessao-27', revisionNumber: 4, agenda: [{ title: 'Projeto de Lei 18/2026' }],
        documents: [{ name: 'Parecer.pdf', mimeType: 'application/pdf' }], canVote: false })
    await expect(readLocalSessionSummary({ root, tenantId: 'camara-b', sessionId: 'sessao-27', trustedKeys }))
      .rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
