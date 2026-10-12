/** Operação da fila de confirmação, restrita à Câmara e sem expor tokens. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'
import { mailTransportConfigured, subscriptionTokenHash } from '@/lib/server/mail-delivery'

export const dynamic = 'force-dynamic'

const requeueSchema = z.object({ id: z.string().trim().min(1) })

export const GET = apiHandler(async (req: Request) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'subscription.manage')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const [pending, sent, canceled, dead, rows] = await Promise.all([
    db.mailDelivery.count({ where: { tenantId, status: 'pending' } }),
    db.mailDelivery.count({ where: { tenantId, status: 'sent' } }),
    db.mailDelivery.count({ where: { tenantId, status: 'canceled' } }),
    db.mailDelivery.count({ where: { tenantId, status: 'dead' } }),
    db.mailDelivery.findMany({ where: { tenantId, status: { in: ['pending', 'dead'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, subscriptionId: true, status: true, attempts: true,
        nextAttemptAt: true, lastErrorCode: true, createdAt: true },
    }),
  ])
  return Response.json({ configured: mailTransportConfigured(), stats: { pending, sent, canceled, dead }, deliveries: rows })
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'subscription.manage')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = requeueSchema.parse(await req.json())

  const outcome = await withTransaction(async (tx) => {
    const delivery = await tx.mailDelivery.findFirst({ where: { id, tenantId },
      include: { subscription: true } })
    if (!delivery) throw notFound('Entrega não encontrada.')
    if (delivery.status !== 'dead') {
      throw new DomainError('CONFLICT_VERSION', 409, 'Entrega não reprocessável', 'Somente uma entrega esgotada pode ser retomada.')
    }
    const subscription = delivery.subscription
    if (!subscription || subscription.tenantId !== tenantId || subscription.confirmedAt ||
        subscription.revokedAt || subscriptionTokenHash(subscription.token) !== delivery.tokenHash) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Confirmação inválida', 'A assinatura foi confirmada, revogada ou teve seu token substituído.')
    }
    const updated = await tx.mailDelivery.updateMany({ where: { id, tenantId, status: 'dead' },
      data: { status: 'pending', attempts: 0, nextAttemptAt: null, lastErrorCode: null,
        leaseOwner: null, leaseUntil: null } })
    if (updated.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Entrega alterada', 'Atualize a fila e tente novamente.')
    await writeAudit(tx, { tenantId, actor, action: 'mail_delivery.requeued',
      aggregateType: 'mail_delivery', aggregateId: id,
      summary: 'Entrega de confirmação esgotada retomada pela gestão.',
      before: { status: 'dead', attempts: delivery.attempts },
      after: { status: 'pending', attempts: 0 }, correlationId, ip: clientIp(req) })
    return { id, status: 'pending' }
  })
  return Response.json({ ok: true, delivery: outcome })
})
