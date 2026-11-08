import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { signPreparedPackage, type TransferManifestV1 } from '@/lib/session-transfer-contract'
import { readTransferPackage, transferPackageStream } from '@/lib/session-transfer-wire'

const manifest: TransferManifestV1 = {
  format: 'edocbr.session-transfer', schemaVersion: 1,
  tenantId: 'camara-a', sessionId: 'sessao-1', revisionId: 'rev-1', revisionNumber: 1,
  sessionVersion: 1, officialConfigurationId: null, createdAt: '2026-11-07T12:00:00Z',
  agendaSnapshot: [], policySnapshot: {}, deliberationPolicySnapshot: { quorumMinimum: 1 },
  matterSnapshot: [], rosterSnapshot: [{ parliamentarianId: 'p1', displayName: 'Pessoa', party: 'AAA', active: true, boardRole: null }],
  artifacts: [{ id: 'a1', source: 'session_document', sourceId: 'd1', name: 'pauta.pdf',
    mimeType: 'application/pdf', sizeBytes: 3,
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }],
}

test('wire frame survives small chunks and rejects truncation, extra bytes and corrupt lengths', async () => {
  const keys = generateKeyPairSync('ed25519')
  const bytesById = new Map<string, Uint8Array>([['a1', Buffer.from('abc')]])
  const signature = signPreparedPackage(manifest, bytesById, 'test', keys.privateKey)
  const data = Buffer.from(await new Response(transferPackageStream({ manifest, signature, bytesById })).arrayBuffer())
  const split = (bytes: Buffer) => new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } })
  expect((await readTransferPackage(split(data))).bytesById.get('a1')).toEqual(Buffer.from('abc'))
  await expect(readTransferPackage(split(data.subarray(0, -1)))).rejects.toThrow('truncado')
  await expect(readTransferPackage(split(Buffer.concat([data, Buffer.from('x')])))).rejects.toThrow('extras')
  const corrupt = Buffer.from(data)
  const artifactLengthOffset = Buffer.from('EDOCBR-STP1\n').length + 4 + Buffer.byteLength(JSON.stringify({ manifest, signature }))
  corrupt.writeBigUInt64BE(BigInt(4), artifactLengthOffset)
  await expect(readTransferPackage(split(corrupt))).rejects.toThrow('divergente')
})
