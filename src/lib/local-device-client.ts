/** Download and atomically prepare one session on a chamber's designated server. */
import { type KeyObject } from 'node:crypto'
import { signedLocalDeviceGet, signedLocalDevicePost } from './local-device-http'
import { importPreparedPackage, readPreparedPackage, type PreparedRevision } from './local-session-package-store'
import { readTransferPackage } from './session-transfer-wire'

export async function downloadAndPrepareSession(args: {
  baseUrl: string
  tenantId: string
  sessionId: string
  deviceId: string
  privateKey: KeyObject
  trustedKeys: ReadonlyMap<string, KeyObject>
  localRoot: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<PreparedRevision> {
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
  const body = JSON.stringify({ issueId, revisionId: prepared.revisionId,
    revisionNumber: prepared.revisionNumber, manifestSha256: prepared.manifestSha256,
    artifacts: verified.manifest.artifacts.map((item) => ({ id: item.id, sha256: item.sha256,
      sizeBytes: item.sizeBytes })) })
  const ack = signedLocalDevicePost({ baseUrl: args.baseUrl, tenantId: args.tenantId,
    deviceId: args.deviceId, privateKey: args.privateKey, body,
    pathAndQuery: `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/transfer-ack` })
  const acknowledged = await fetcher(ack.url, { ...ack.init, signal: args.signal })
  if (!acknowledged.ok) throw new Error(`Pacote importado, mas confirmação recusada pelo SaaS (HTTP ${acknowledged.status}).`)
  return prepared
}
