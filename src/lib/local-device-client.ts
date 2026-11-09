/** Download and atomically prepare one session on a chamber's designated server. */
import { type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { signedLocalDeviceGet, signedLocalDevicePost } from './local-device-http'
import { importPreparedPackage, readPreparedPackage, type PreparedRevision } from './local-session-package-store'
import { readTransferPackage } from './session-transfer-wire'

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
    pathAndQuery: `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/transfer` })
  const fetcher = args.fetchImpl ?? fetch
  const response = await fetcher(url, { ...init, signal: args.signal })
  if (!response.ok) throw new Error(`Transferência da sessão recusada pelo SaaS (HTTP ${response.status}).`)
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/vnd.edocbr.session-transfer.v1' || !response.body) {
    throw new Error('Resposta de transferência sem formato ou corpo esperado.')
  }
  const issueId = response.headers.get('x-edocbr-transfer-issue-id')
  if (!issueId) throw new Error('Emissão de pacote sem identificador de confirmação.')
  const wire = await readTransferPackage(response.body)
  const prepared = await importPreparedPackage({ ...wire, root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
  const verified = await readPreparedPackage({ root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
  if (verified.prepared.manifestSha256 !== prepared.manifestSha256) {
    throw new Error('Revisão local mudou antes da confirmação.')
  }
  await sendTransferAck(args, issueId, verified)
  return prepared
}
