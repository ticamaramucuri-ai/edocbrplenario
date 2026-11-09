/** Signed, short lived SaaS grant for one local session authority epoch. */
import { createHash, sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod'

const id = z.string().min(1).max(200)
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const instant = z.string().datetime({ offset: true })

export const sessionAuthorityGrantSchema = z.object({
  format: z.literal('edocbr.session-authority'),
  schemaVersion: z.literal(1),
  tenantId: id,
  sessionId: id,
  deviceId: id,
  revisionId: id,
  manifestSha256: sha256,
  epoch: z.number().int().safe().positive(),
  issuedAt: instant,
  notBefore: instant,
  expiresAt: instant,
}).strict()

export type SessionAuthorityGrant = z.infer<typeof sessionAuthorityGrantSchema>
export type SignedSessionAuthorityGrant = {
  grant: SessionAuthorityGrant
  signature: { algorithm: 'Ed25519'; keyId: string; valueBase64: string }
}
const signedGrantSchema = z.object({
  grant: sessionAuthorityGrantSchema,
  signature: z.object({
    algorithm: z.literal('Ed25519'), keyId: id,
    valueBase64: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  }).strict(),
}).strict()

function bytes(grant: SessionAuthorityGrant): Buffer {
  const ordered = {
    format: grant.format, schemaVersion: grant.schemaVersion, tenantId: grant.tenantId,
    sessionId: grant.sessionId, deviceId: grant.deviceId, revisionId: grant.revisionId,
    manifestSha256: grant.manifestSha256, epoch: grant.epoch, issuedAt: grant.issuedAt,
    notBefore: grant.notBefore, expiresAt: grant.expiresAt,
  }
  return Buffer.from(`edocbr.session-authority.v1\n${JSON.stringify(ordered)}`, 'utf8')
}

function checkedGrant(input: unknown): SessionAuthorityGrant {
  const grant = sessionAuthorityGrantSchema.parse(input)
  const issued = Date.parse(grant.issuedAt)
  const start = Date.parse(grant.notBefore)
  const end = Date.parse(grant.expiresAt)
  if (start < issued || end <= start || end - issued > 15 * 60_000) {
    throw new Error('Janela da autoridade local inválida.')
  }
  return grant
}

export function signSessionAuthorityGrant(grantInput: SessionAuthorityGrant, keyId: string,
  privateKey: KeyObject): SignedSessionAuthorityGrant {
  const grant = checkedGrant(grantInput)
  if (!keyId || privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Chave de concessão inválida.')
  }
  return { grant, signature: { algorithm: 'Ed25519', keyId,
    valueBase64: sign(null, bytes(grant), privateKey).toString('base64') } }
}

export function verifySessionAuthorityGrant(signed: SignedSessionAuthorityGrant, options: {
  tenantId: string; sessionId: string; deviceId: string; revisionId: string
  manifestSha256: string; trustedKeys: ReadonlyMap<string, KeyObject>
  now?: Date; minimumEpoch?: number
}): SessionAuthorityGrant {
  const parsed = signedGrantSchema.parse(signed)
  const grant = checkedGrant(parsed.grant)
  const key = options.trustedKeys.get(parsed.signature.keyId)
  const signature = parsed.signature.valueBase64
  if (!key || key.type !== 'public' || key.asymmetricKeyType !== 'ed25519' ||
      !verify(null, bytes(grant), key, Buffer.from(signature, 'base64'))) {
    throw new Error('Assinatura da autoridade local inválida.')
  }
  if (grant.tenantId !== options.tenantId || grant.sessionId !== options.sessionId ||
      grant.deviceId !== options.deviceId || grant.revisionId !== options.revisionId ||
      grant.manifestSha256 !== options.manifestSha256) {
    throw new Error('Concessão não corresponde à sessão preparada neste dispositivo.')
  }
  const now = (options.now ?? new Date()).getTime()
  if (!Number.isFinite(now) || now < Date.parse(grant.notBefore) || now >= Date.parse(grant.expiresAt)) {
    throw new Error('Concessão de autoridade local fora da validade.')
  }
  if (options.minimumEpoch !== undefined && (!Number.isSafeInteger(options.minimumEpoch) ||
      grant.epoch < options.minimumEpoch)) {
    throw new Error('Época de autoridade local obsoleta.')
  }
  return grant
}

export function sessionAuthorityGrantHash(grant: SessionAuthorityGrant): string {
  return createHash('sha256').update(bytes(checkedGrant(grant))).digest('hex')
}
