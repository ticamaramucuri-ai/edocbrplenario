/** Framed, versioned transfer of a signed manifest and its exact artifact bytes. */
import type { TransferManifestV1, TransferSignatureV1 } from './session-transfer-contract'

const MAGIC = Buffer.from('EDOCBR-STP1\n')
const MAX_HEADER = 2 * 1024 * 1024
const MAX_ARTIFACTS = 500
const MAX_TOTAL = 512 * 1024 * 1024

export type WirePackage = {
  manifest: TransferManifestV1
  signature: TransferSignatureV1
  bytesById: Map<string, Uint8Array>
}

export function transferPackageStream(args: WirePackage): ReadableStream<Uint8Array> {
  const artifacts = args.manifest.artifacts
  const total = artifacts.reduce((sum, item) => sum + item.sizeBytes, 0)
  if (artifacts.length > MAX_ARTIFACTS || total > MAX_TOTAL ||
      args.bytesById.size !== artifacts.length) throw new Error('Pacote excede os limites de transporte.')
  const header = Buffer.from(JSON.stringify({ manifest: args.manifest, signature: args.signature }))
  if (header.length > MAX_HEADER) throw new Error('Cabeçalho de transferência excede o limite.')
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(header.length)
  let index = -1
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === -1) {
        controller.enqueue(MAGIC)
        controller.enqueue(headerLength)
        controller.enqueue(header)
        index = 0
        return
      }
      if (index === artifacts.length) { controller.close(); return }
      const artifact = artifacts[index++]
      const bytes = args.bytesById.get(artifact.id)
      if (!bytes || bytes.byteLength !== artifact.sizeBytes) {
        controller.error(new Error('Artefato diverge do manifesto.'))
        return
      }
      const length = Buffer.alloc(8)
      length.writeBigUInt64BE(BigInt(bytes.byteLength))
      controller.enqueue(length)
      controller.enqueue(bytes)
    },
  })
}

/** Parse without trusting Content-Length or allocating from an unbounded frame. */
export async function readTransferPackage(stream: ReadableStream<Uint8Array>): Promise<WirePackage> {
  const reader = stream.getReader()
  let pending = Buffer.alloc(0)
  async function exact(size: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let remaining = size
    while (remaining > 0) {
      if (!pending.length) {
        const next = await reader.read()
        if (next.done) throw new Error('Pacote truncado.')
        pending = Buffer.from(next.value)
        if (!pending.length) continue
      }
      const take = Math.min(remaining, pending.length)
      chunks.push(pending.subarray(0, take))
      pending = pending.subarray(take)
      remaining -= take
    }
    return Buffer.concat(chunks, size)
  }
  try {
    if (!(await exact(MAGIC.length)).equals(MAGIC)) throw new Error('Formato de pacote inválido.')
    const headerLength = (await exact(4)).readUInt32BE()
    if (headerLength < 2 || headerLength > MAX_HEADER) throw new Error('Cabeçalho de pacote inválido.')
    const header: unknown = JSON.parse((await exact(headerLength)).toString('utf8'))
    if (!header || typeof header !== 'object' || !('manifest' in header) || !('signature' in header)) {
      throw new Error('Metadados de pacote inválidos.')
    }
    const { manifest, signature } = header as { manifest: TransferManifestV1; signature: TransferSignatureV1 }
    if (!manifest || !Array.isArray(manifest.artifacts) || manifest.artifacts.length > MAX_ARTIFACTS) {
      throw new Error('Manifesto de pacote inválido.')
    }
    const bytesById = new Map<string, Uint8Array>()
    let total = 0
    for (const artifact of manifest.artifacts) {
      if (!artifact || typeof artifact.id !== 'string' || typeof artifact.sizeBytes !== 'number' ||
          !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0 ||
          bytesById.has(artifact.id)) throw new Error('Artefato de pacote inválido.')
      total += artifact.sizeBytes
      if (total > MAX_TOTAL) throw new Error('Pacote excede os limites de transporte.')
      const size = (await exact(8)).readBigUInt64BE()
      if (size !== BigInt(artifact.sizeBytes)) throw new Error('Tamanho de artefato divergente.')
      bytesById.set(artifact.id, await exact(artifact.sizeBytes))
    }
    if (pending.length || !(await reader.read()).done) throw new Error('Pacote contém bytes extras.')
    return { manifest, signature, bytesById }
  } finally { await reader.cancel().catch(() => undefined) }
}
