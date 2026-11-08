/** Signed GET request shared by the preparation download and discovery client. */
import { createHash, randomBytes, sign, type KeyObject } from 'node:crypto'
import { localDeviceRequestMessage, localDeviceRequestMessageV2 } from './local-device-request'

export function localSaasOrigin(baseUrl: string): URL {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
      base.pathname !== '/') throw new Error('Servidor SaaS deve usar URL HTTPS de origem sem credenciais ou parâmetros.')
  return base
}

export function signedLocalDeviceGet(args: {
  baseUrl: string
  pathAndQuery: string
  tenantId: string
  deviceId: string
  privateKey: KeyObject
}): { url: URL; init: RequestInit } {
  const base = localSaasOrigin(args.baseUrl)
  if (args.privateKey.asymmetricKeyType !== 'ed25519' || args.privateKey.type !== 'private') {
    throw new Error('Chave privada do desktop deve ser Ed25519.')
  }
  if (!args.tenantId || !args.deviceId || !args.pathAndQuery.startsWith('/') ||
      args.pathAndQuery.startsWith('//') || args.pathAndQuery.includes('#')) {
    throw new Error('Pedido do desktop inválido.')
  }
  const url = new URL(args.pathAndQuery, base)
  if (url.origin !== base.origin || url.pathname + url.search !== args.pathAndQuery) {
    throw new Error('Caminho assinado diverge da requisição.')
  }
  const timestamp = String(Date.now())
  const nonce = randomBytes(24).toString('base64url')
  const message = localDeviceRequestMessage({ tenantId: args.tenantId, deviceId: args.deviceId,
    method: 'GET', pathAndQuery: args.pathAndQuery, timestamp, nonce })
  return { url, init: { method: 'GET', cache: 'no-store', redirect: 'error', headers: {
    'x-edocbr-tenant-id': args.tenantId,
    'x-edocbr-device-id': args.deviceId,
    'x-edocbr-device-timestamp': timestamp,
    'x-edocbr-device-nonce': nonce,
    'x-edocbr-device-signature': sign(null, message, args.privateKey).toString('base64'),
  } } }
}

export function signedLocalDevicePost(args: {
  baseUrl: string
  pathAndQuery: string
  tenantId: string
  deviceId: string
  privateKey: KeyObject
  body: string
}): { url: URL; init: RequestInit } {
  const base = localSaasOrigin(args.baseUrl)
  if (args.privateKey.asymmetricKeyType !== 'ed25519' || args.privateKey.type !== 'private' ||
      !args.tenantId || !args.deviceId || !args.pathAndQuery.startsWith('/') ||
      args.pathAndQuery.startsWith('//') || args.pathAndQuery.includes('#')) {
    throw new Error('Pedido assinado do desktop inválido.')
  }
  const url = new URL(args.pathAndQuery, base)
  if (url.origin !== base.origin || url.pathname + url.search !== args.pathAndQuery) {
    throw new Error('Caminho assinado diverge da requisição.')
  }
  const timestamp = String(Date.now())
  const nonce = randomBytes(24).toString('base64url')
  const bodySha256 = createHash('sha256').update(Buffer.from(args.body, 'utf8')).digest('hex')
  const message = localDeviceRequestMessageV2({ tenantId: args.tenantId, deviceId: args.deviceId,
    method: 'POST', pathAndQuery: args.pathAndQuery, timestamp, nonce, bodySha256 })
  return { url, init: { method: 'POST', cache: 'no-store', redirect: 'error', body: args.body,
    headers: { 'content-type': 'application/json', 'x-edocbr-tenant-id': args.tenantId,
      'x-edocbr-device-id': args.deviceId, 'x-edocbr-device-timestamp': timestamp,
      'x-edocbr-device-nonce': nonce, 'x-edocbr-body-sha256': bodySha256,
      'x-edocbr-device-signature': sign(null, message, args.privateKey).toString('base64') } } }
}
