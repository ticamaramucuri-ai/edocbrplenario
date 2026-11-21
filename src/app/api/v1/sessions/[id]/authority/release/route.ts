/**
 * POST /api/v1/sessions/:id/authority/release — libera/encerra concessão de autoridade local ativa.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  justification: z.string().trim().min(5, 'Informe justificativa com ao menos 5 caracteres.').max(2000),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())
  const session = await loadSession(actor, id)
  const now = new Date()

  const released = await withTransaction(async (tx) => {
    const lease = await tx.localSessionAuthorityLease.findUnique({
      where: { sessionId: session.id },
      select: { sessionId: true, tenantId: true, epoch: true, expiresAt: true, deviceId: true },
    })
    if (!lease || lease.tenantId !== session.tenantId || lease.expiresAt <= now) {
      throw new DomainError('LOCAL_AUTHORITY_PRECONDITION', 409, 'Sem autoridade ativa', 'Não há concessão de autoridade local vigente para liberar nesta sessão.')
    }
    await tx.localSessionAuthorityLease.update({
      where: { sessionId: session.id },
      data: { expiresAt: now },
    })
    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'authority.released',
      aggregateType: 'session',
      aggregateId: session.id,
      summary: `Concessão de autoridade local (época ${lease.epoch}) liberada manualmente para retomada web.`,
      before: { epoch: lease.epoch, expiresAt: lease.expiresAt.toISOString() },
      after: { epoch: lease.epoch, expiresAt: now.toISOString(), deviceId: lease.deviceId },
      justification: body.justification,
      correlationId,
      ip: clientIp(req),
    })
    return { sessionId: session.id, epoch: lease.epoch, releasedAt: now.toISOString() }
  })

  return Response.json({ released })
})
