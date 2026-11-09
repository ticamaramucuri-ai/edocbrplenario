/** Download and atomically prepare one session on a chamber's designated server. */
import { createHash, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { signedLocalDeviceGet, signedLocalDevicePost } from './local-device-http'
import { importPreparedPackage, readPreparedPackage, type PreparedRevision } from './local-session-package-store'
import { cacheTransferArtifact, clearTransferCache, readCachedTransferArtifact } from './local-session-transfer-cache'
import { canonicalManifest, transferManifestV1Schema, verifySignedTransferManifest,
  type TransferSignatureV1 } from './session-transfer-contract'

type ClientArgs = {
  baseUrl: string
  tenantId: string
  sessionId: string
  deviceId: string
  privateKey: KeyObject
  trustedKeys: ReadonlyMap<string, KeyObject>
  localRoot: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

const artifactSchema = z.object({ id: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }).strict()
const statusSchema = z.object({ issueId: z.string().min(1), revisionId: z.string().min(1),
  revisionNumber: z.number().int().positive(), manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  artifacts: z.array(artifactSchema), acknowledgedAt: z.string().nullable() }).strict()
const issuedManifestSchema = z.object({ issueId: z.string().min(1).max(200),
  manifest: transferManifestV1Schema,
  signature: z.object({ algorithm: z.literal('Ed25519'), keyId: z.string().min(1),
    valueBase64: z.string().min(1) }).strict() }).strict()

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new Error('Resposta de manifesto sem corpo.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      total += item.value.byteLength
      if (total > maxBytes) throw new Error('Manifesto excede o limite de leitura.')
      chunks.push(item.value)
    }
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8')) as unknown
  } finally { await reader.cancel().catch(() => undefined) }
}

async function boundedArtifact(response: Response, size: number): Promise<Uint8Array> {
  if (!response.body || !Number.isSafeInteger(size) || size < 0 || size > 50 * 1024 * 1024) {
    throw new Error('Resposta de artefato ausente ou fora do limite.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      total += item.value.byteLength
      if (total > size) throw new Error('Artefato recebido excede o tamanho assinado.')
      chunks.push(item.value)
    }
    if (total !== size) throw new Error('Artefato recebido está truncado.')
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  } finally { await reader.cancel().catch(() => undefined) }
}

function artifactReceipt(artifacts: Array<{ id: string; sha256: string; sizeBytes: number }>) {
  return artifacts.map((item) => ({ id: item.id, sha256: item.sha256, sizeBytes: item.sizeBytes }))
}

async function sendTransferAck(args: ClientArgs, issueId: string,
  verified: Awaited<ReturnType<typeof readPreparedPackage>>): Promise<void> {
  const body = JSON.stringify({ issueId, revisionId: verified.prepared.revisionId,
    revisionNumber: verified.prepared.revisionNumber, manifestSha256: verified.prepared.manifestSha256,
    artifacts: artifactReceipt(verified.manifest.artifacts) })
  const ack = signedLocalDevicePost({ baseUrl: args.baseUrl, tenantId: args.tenantId,
    deviceId: args.deviceId, privateKey: args.privateKey, body,
    pathAndQuery: `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/transfer-ack` })
  const response = await (args.fetchImpl ?? fetch)(ack.url, { ...ack.init, signal: args.signal })
  if (!response.ok) throw new Error(`Pacote importado, mas confirmação recusada pelo SaaS (HTTP ${response.status}).`)
}

/** Return a complete local revision if the SaaS already issued it; retry only a lost ACK. */
export async function recoverPreparedSession(args: ClientArgs & { expectedRevisionId: string }): Promise<PreparedRevision | null> {
  let verified: Awaited<ReturnType<typeof readPreparedPackage>>
  try { verified = await readPreparedPackage({ root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error instanceof Error && error.message === 'Sessão não preparada localmente.')) return null
    throw error
  }
  if (verified.prepared.revisionId !== args.expectedRevisionId) return null
  const pathAndQuery = `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/transfer-status` +
    `?revisionId=${encodeURIComponent(verified.prepared.revisionId)}&manifestSha256=${verified.prepared.manifestSha256}`
  const statusRequest = signedLocalDeviceGet({ baseUrl: args.baseUrl, tenantId: args.tenantId,
    deviceId: args.deviceId, privateKey: args.privateKey, pathAndQuery })
  const response = await (args.fetchImpl ?? fetch)(statusRequest.url, { ...statusRequest.init, signal: args.signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Consulta de emissão recusada pelo SaaS (HTTP ${response.status}).`)
  const status = statusSchema.parse(await response.json())
  if (status.revisionId !== verified.prepared.revisionId ||
      status.revisionNumber !== verified.prepared.revisionNumber ||
      status.manifestSha256 !== verified.prepared.manifestSha256 ||
      JSON.stringify(status.artifacts) !== JSON.stringify(artifactReceipt(verified.manifest.artifacts))) {
    throw new Error('Emissão SaaS diverge do pacote verificado no disco local.')
  }
  if (!status.acknowledgedAt) await sendTransferAck(args, status.issueId, verified)
  return verified.prepared
}

export async function downloadAndPrepareSession(args: ClientArgs): Promise<PreparedRevision> {
  if (!args.tenantId || !args.sessionId || !args.deviceId || !args.trustedKeys.size) {
    throw new Error('Identidade do desktop e confiança da Câmara são obrigatórias.')
  }
  const { url, init } = signedLocalDeviceGet({ baseUrl: args.baseUrl, tenantId: args.tenantId,
    deviceId: args.deviceId, privateKey: args.privateKey,
    pathAndQuery: `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/transfer-manifest` })
  const fetcher = args.fetchImpl ?? fetch
  const response = await fetcher(url, { ...init, signal: args.signal })
  if (!response.ok) throw new Error(`Manifesto da sessão recusado pelo SaaS (HTTP ${response.status}).`)
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new Error('Resposta de manifesto em formato inválido.')
  }
  const issued = issuedManifestSchema.parse(await boundedJson(response, 2 * 1024 * 1024))
  const manifest = verifySignedTransferManifest({ manifest: issued.manifest,
    signature: issued.signature as TransferSignatureV1,
    expectedTenantId: args.tenantId, expectedSessionId: args.sessionId,
    minimumRevisionNumber: 0, trustedKeys: args.trustedKeys })
  if (manifest.artifacts.length > 500 || manifest.artifacts.reduce((sum, item) => sum + item.sizeBytes, 0) > 512 * 1024 * 1024) {
    throw new Error('Manifesto excede os limites da transferência local.')
  }
  const manifestSha256 = createHash('sha256').update(canonicalManifest(manifest)).digest('hex')
  const bytesById = new Map<string, Uint8Array>()
  for (const artifact of manifest.artifacts) {
    let bytes = await readCachedTransferArtifact({ root: args.localRoot, tenantId: args.tenantId,
      sessionId: args.sessionId, manifestSha256, artifact })
    if (!bytes) {
      const pathAndQuery = `/api/v1/sessions/${encodeURIComponent(args.sessionId)}` +
        `/transfer-artifacts/${encodeURIComponent(artifact.id)}?issueId=${encodeURIComponent(issued.issueId)}`
      const request = signedLocalDeviceGet({ baseUrl: args.baseUrl, tenantId: args.tenantId,
        deviceId: args.deviceId, privateKey: args.privateKey, pathAndQuery })
      const artifactResponse = await fetcher(request.url, { ...request.init, signal: args.signal })
      if (!artifactResponse.ok) throw new Error(`Artefato da sessão recusado pelo SaaS (HTTP ${artifactResponse.status}).`)
      if (artifactResponse.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream') {
        throw new Error('Resposta de artefato em formato inválido.')
      }
      bytes = await boundedArtifact(artifactResponse, artifact.sizeBytes)
      await cacheTransferArtifact({ root: args.localRoot, tenantId: args.tenantId,
        sessionId: args.sessionId, manifestSha256, artifact, bytes })
    }
    bytesById.set(artifact.id, bytes)
  }
  const prepared = await importPreparedPackage({ manifest, signature: issued.signature,
    bytesById, root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
  const verified = await readPreparedPackage({ root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
  if (verified.prepared.manifestSha256 !== prepared.manifestSha256) {
    throw new Error('Revisão local mudou antes da confirmação.')
  }
  await clearTransferCache({ root: args.localRoot, tenantId: args.tenantId, sessionId: args.sessionId })
  await sendTransferAck(args, issued.issueId, verified)
  return prepared
}
