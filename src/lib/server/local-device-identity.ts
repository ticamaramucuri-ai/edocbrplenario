import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto'
import { Prisma, type LocalServerDevice } from '@prisma/client'
import { db } from '@/lib/db'
import { DomainError, forbiddenRole, mfaRequired, unauthenticated } from './errors'
import { resolveActor } from './actor'
import { requirePermission } from './rbac'
import { getSessionToken, resolveSessionContext } from './session'

const WINDOW_MS = 120_000
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** Device management needs a real, non-impersonated tenant admin login with MFA. */
export async function requireLocalDeviceAdministrator(req: Request): Promise<{ id: string; name: string; role: 'tenant_admin'; tenantId: string }> {
  const actor = await resolveActor(req)
  requirePermission(actor, 'local.device.manage')
  const token = getSessionToken(req)
  if (!token) throw unauthenticated('Use uma sessão autenticada para gerir o servidor local.')
  const context = await resolveSessionContext(token)
  if (!context || context.impersonation || context.user.id !== actor.id || context.sessionUser.id !== actor.id) {
    throw forbiddenRole('Gestão do servidor local exige login nominal sem impersonação.')
  }
  if (!context.user.mfaEnabled) throw mfaRequired('Ative o segundo fator antes de gerir o servidor local.')
  if (!context.session.mfaVerifiedAt) throw mfaRequired('Entre novamente com o segundo fator para gerir o servidor local.')
  if (req.method !== 'GET' && req.headers.get('x-edocbr-admin-action') !== '1') {
    throw forbiddenRole('Cabeçalho de ação administrativa obrigatório.')
  }
  if (!actor.tenantId || actor.role !== 'tenant_admin') throw forbiddenRole('Administrador da Câmara obrigatório.')
  return { id: actor.id, name: actor.name, role: 'tenant_admin', tenantId: actor.tenantId }
}

export function parseLocalDevicePublicKey(pem: string): { publicKeyPem: string; publicKeySpkiSha256: string } {
  if (pem.length > 1000 || !pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Chave pública PEM inválida.')
  let key: KeyObject
  try { key = createPublicKey(pem) } catch { throw new Error('Chave pública PEM inválida.') }
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') throw new Error('Chave do desktop deve ser Ed25519.')
  return { publicKeyPem: key.export({ format: 'pem', type: 'spki' }).toString(),
    publicKeySpkiSha256: sha256(key.export({ format: 'der', type: 'spki' }) as Buffer) }
}

export function localDeviceRequestMessage(args: {
  tenantId: string; deviceId: string; method: string; pathAndQuery: string; timestamp: string; nonce: string
}): Buffer {
  return Buffer.from(['edocbr.local-device.request.v1', args.tenantId, args.deviceId,
    args.method.toUpperCase(), args.pathAndQuery, args.timestamp, args.nonce].join('\n'), 'utf8')
}

/** Consume a nonce only after signature, tenant, designation and clock checks. */
export async function authenticateLocalDeviceRequest(req: Request, tenantId: string): Promise<LocalServerDevice> {
  const deviceId = req.headers.get('x-edocbr-device-id') ?? ''
  const timestamp = req.headers.get('x-edocbr-device-timestamp') ?? ''
  const nonce = req.headers.get('x-edocbr-device-nonce') ?? ''
  const encodedSignature = req.headers.get('x-edocbr-device-signature') ?? ''
  if (!/^[0-9]{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > WINDOW_MS ||
      !/^[A-Za-z0-9_-]{22,86}$/.test(nonce) || !/^[A-Za-z0-9+/]{86}==$/.test(encodedSignature)) {
    throw unauthenticated('Credenciais do servidor local inválidas ou expiradas.')
  }
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { active: true } })
  const designation = await db.localServerDesignation.findUnique({ where: { tenantId } })
  const device = deviceId && await db.localServerDevice.findFirst({ where: { id: deviceId, tenantId, status: 'registered' } })
  if (!tenant?.active || !designation?.deviceId || designation.deviceId !== deviceId || !device) {
    throw unauthenticated('Servidor local não designado para esta Câmara.')
  }
  const signature = Buffer.from(encodedSignature, 'base64')
  if (signature.length !== 64 || signature.toString('base64') !== encodedSignature) {
    throw unauthenticated('Assinatura do servidor local inválida.')
  }
  const url = new URL(req.url)
  const message = localDeviceRequestMessage({ tenantId, deviceId, method: req.method,
    pathAndQuery: url.pathname + url.search, timestamp, nonce })
  let valid = false
  try { valid = verifySignature(null, message, createPublicKey(device.publicKeyPem), signature) } catch { /* deny */ }
  if (!valid) throw unauthenticated('Assinatura do servidor local inválida.')
  try {
    await db.$transaction(async (tx) => {
      const selected = await tx.localServerDesignation.findUnique({ where: { tenantId } })
      const stillActive = await tx.localServerDevice.findFirst({ where: { id: deviceId, tenantId, status: 'registered' } })
      if (selected?.deviceId !== deviceId || !stillActive) throw unauthenticated('Servidor local não designado para esta Câmara.')
      const nonceHash = sha256(nonce)
      const previous = await tx.localDeviceRequestNonce.findUnique({ where: {
        tenantId_deviceId_nonceHash: { tenantId, deviceId, nonceHash } } })
      if (previous) throw new DomainError('LOCAL_DEVICE_REPLAY', 409, 'Pedido repetido', 'O pedido deste servidor local já foi recebido.')
      await tx.localDeviceRequestNonce.create({ data: { tenantId, deviceId, nonceHash,
        expiresAt: new Date(Number(timestamp) + WINDOW_MS) } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new DomainError('LOCAL_DEVICE_REPLAY', 409, 'Pedido repetido', 'O pedido deste servidor local já foi recebido.')
    }
    throw error
  }
  return device
}
