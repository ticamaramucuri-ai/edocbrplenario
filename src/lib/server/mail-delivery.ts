/** Fila de confirmação de assinatura. O token vigente permanece só na assinatura. */
import { createHash, randomUUID } from 'node:crypto'
import type { CitizenSubscription, Prisma, PrismaClient } from '@prisma/client'

export type MailSender = (message: { to: string; subject: string; text: string }) => Promise<void>

export const subscriptionTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export async function queueSubscriptionConfirmation(tx: Prisma.TransactionClient, subscription: CitizenSubscription) {
  const tokenHash = subscriptionTokenHash(subscription.token)
  return tx.mailDelivery.upsert({ where: { subscriptionId_tokenHash: { subscriptionId: subscription.id, tokenHash } },
    create: { tenantId: subscription.tenantId, subscriptionId: subscription.id, tokenHash }, update: {} })
}

export function mailTransportConfigured(env: { SMTP_HOST?: string; SMTP_FROM?: string; PUBLIC_BASE_URL?: string; SMTP_USER?: string; SMTP_PASSWORD?: string } = {
  SMTP_HOST: process.env.SMTP_HOST, SMTP_FROM: process.env.SMTP_FROM, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  SMTP_USER: process.env.SMTP_USER, SMTP_PASSWORD: process.env.SMTP_PASSWORD,
}) {
  if (!env.SMTP_HOST?.trim() || !env.SMTP_FROM?.trim() || !env.PUBLIC_BASE_URL?.trim() ||
      Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) return false
  try { confirmationUrl(env.PUBLIC_BASE_URL, 'verificacao'); return true } catch { return false }
}

export function confirmationUrl(baseUrl: string, token: string) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('PUBLIC_BASE_URL deve usar HTTPS público ou HTTP local de ensaio.')
  }
  if (base.username || base.password || base.hash) throw new Error('PUBLIC_BASE_URL inválida.')
  return new URL(`/api/v1/public/subscriptions/confirm?token=${encodeURIComponent(token)}`, base).toString()
}

const MAX_ATTEMPTS = 5
const BACKOFF_SECONDS = [30, 120, 600, 1800]

/** Entrega pelo menos uma vez. Lease expirada permite retomar após queda do worker. */
export async function processMailBatch(db: PrismaClient, send: MailSender, baseUrl: string,
  now = new Date(), limit = 10) {
  const owner = randomUUID()
  const rows = await db.mailDelivery.findMany({ where: { status: 'pending',
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }],
  }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })
  let processed = 0
  for (const row of rows) {
    const claim = await db.mailDelivery.updateMany({ where: { id: row.id, status: 'pending',
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
    }, data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 180_000) } })
    if (!claim.count) continue
    processed++
    const subscription = await db.citizenSubscription.findUnique({ where: { id: row.subscriptionId }, include: { tenant: true } })
    if (!subscription || subscription.tenantId !== row.tenantId || subscription.confirmedAt || subscription.revokedAt ||
        subscriptionTokenHash(subscription.token) !== row.tokenHash) {
      await db.mailDelivery.updateMany({ where: { id: row.id, leaseOwner: owner, status: 'pending' },
        data: { status: 'canceled', leaseOwner: null, leaseUntil: null } })
      continue
    }
    try {
      const link = confirmationUrl(baseUrl, subscription.token)
      await send({ to: subscription.email, subject: `Confirme seu acompanhamento — ${subscription.tenant.name}`,
        text: `Você solicitou acompanhar uma atividade de ${subscription.tenant.name}.\n\nConfirme sua assinatura: ${link}\n\nSe não fez esta solicitação, ignore esta mensagem.` })
      await db.mailDelivery.updateMany({ where: { id: row.id, leaseOwner: owner, status: 'pending' },
        data: { status: 'sent', attempts: { increment: 1 }, sentAt: now,
          nextAttemptAt: null, lastErrorCode: null, leaseOwner: null, leaseUntil: null } })
    } catch {
      const attempts = row.attempts + 1
      await db.mailDelivery.updateMany({ where: { id: row.id, leaseOwner: owner, status: 'pending' },
        data: { status: attempts >= MAX_ATTEMPTS ? 'dead' : 'pending', attempts,
          nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + BACKOFF_SECONDS[attempts - 1]! * 1000),
          lastErrorCode: 'MAIL_DELIVERY_FAILED', leaseOwner: null, leaseUntil: null } })
    }
  }
  return processed
}
