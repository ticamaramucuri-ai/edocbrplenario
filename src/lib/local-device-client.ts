/** Download and atomically prepare one session on a chamber's designated server. */
import { randomBytes, sign, type KeyObject } from 'node:crypto'
import { localDeviceRequestMessage } from './local-device-request'
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
  const base = new URL(args.baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('Servidor SaaS deve usar URL HTTPS sem credenciais ou parâmetros.')
  }
  if (args.privateKey.asymmetricKeyType !== 'ed25519' || args.privateKey.type !== 'private') {
    throw new Error('Chave privada do desktop deve ser Ed25519.')
  }
  if (!args.tenantId || !args.sessionId || !args.deviceId || !args.trustedKeys.size) {
    throw new Error('Identidade do desktop e confiança da Câmara são obrigatórias.')
  }
  const url = new URL(`/api/v1/sessions/${encodeURIComponent(args.sessionId)}/transfer`, base)
  if (url.origin !== base.origin) throw new Error('Origem SaaS inválida.')
  const timestamp = String(Date.now())
  const nonce = randomBytes(24).toString('base64url')
  const message = localDeviceRequestMessage({ tenantId: args.tenantId, deviceId: args.deviceId,
    method: 'GET', pathAndQuery: url.pathname + url.search, timestamp, nonce })
  const signature = sign(null, message, args.privateKey).toString('base64')
  const fetcher = args.fetchImpl ?? fetch
  const response = await fetcher(url, { method: 'GET', cache: 'no-store', redirect: 'error',
    headers: { 'x-edocbr-tenant-id': args.tenantId, 'x-edocbr-device-id': args.deviceId,
      'x-edocbr-device-timestamp': timestamp, 'x-edocbr-device-nonce': nonce,
      'x-edocbr-device-signature': signature }, signal: args.signal })
  if (!response.ok) throw new Error(`Transferência da sessão recusada pelo SaaS (HTTP ${response.status}).`)
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/vnd.edocbr.session-transfer.v1' || !response.body) {
    throw new Error('Resposta de transferência sem formato ou corpo esperado.')
  }
  const wire = await readTransferPackage(response.body)
  return importPreparedPackage({ ...wire, root: args.localRoot, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
}
