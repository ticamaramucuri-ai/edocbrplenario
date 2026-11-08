/** Download and atomically prepare one session on a chamber's designated server. */
import { type KeyObject } from 'node:crypto'
import { signedLocalDeviceGet } from './local-device-http'
import { importPreparedPackage, type PreparedRevision } from './local-session-package-store'
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
  const wire = await readTransferPackage(response.body)
  return importPreparedPackage({ ...wire, root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
}
