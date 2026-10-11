import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

export type RealtimeGrant = {
  v: 1
  tenantId: string
  actorId: string
  exp: number
  nonce: string
}

const TTL_SECONDS = 120

export function realtimeSecret(): string | null {
  const secret = process.env.REALTIME_AUTH_SECRET
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

export function issueRealtimeGrant(
  tenantId: string,
  actorId: string,
  secret: string,
  now = Date.now(),
): string {
  const grant: RealtimeGrant = {
    v: 1,
    tenantId,
    actorId,
    exp: Math.floor(now / 1000) + TTL_SECONDS,
    nonce: randomBytes(12).toString('base64url'),
  }
  const body = Buffer.from(JSON.stringify(grant)).toString('base64url')
  return `${body}.${sign(body, secret).toString('base64url')}`
}

export function verifyRealtimeGrant(
  token: unknown,
  secret: string,
  now = Date.now(),
): RealtimeGrant | null {
  if (typeof token !== 'string' || token.length > 2048) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!body || !signature) return null
  try {
    const received = Buffer.from(signature, 'base64url')
    const expected = sign(body, secret)
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
    const raw: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!raw || typeof raw !== 'object') return null
    const grant = raw as Partial<RealtimeGrant>
    const nowSeconds = Math.floor(now / 1000)
    if (
      grant.v !== 1 ||
      typeof grant.tenantId !== 'string' || !/^c[A-Za-z0-9]{20,40}$/.test(grant.tenantId) ||
      typeof grant.actorId !== 'string' || grant.actorId.length < 1 ||
      typeof grant.nonce !== 'string' || grant.nonce.length < 8 ||
      typeof grant.exp !== 'number' || !Number.isInteger(grant.exp) ||
      grant.exp <= nowSeconds || grant.exp > nowSeconds + TTL_SECONDS
    ) return null
    return grant as RealtimeGrant
  } catch {
    return null
  }
}
