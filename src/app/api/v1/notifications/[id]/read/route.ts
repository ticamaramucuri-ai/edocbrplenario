/**
 * POST /api/v1/notifications/:id/read — marca readAt=now na notificação
 * visível ao ator (targetRole null ou = papel do ator; escopo de tenant).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import type { NotificationView, Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const notification = await db.notification.findUnique({ where: { id } })
  if (!notification) throw notFound('Notificação não encontrada.')
  assertTenantScope(actor, notification.tenantId)
  if (notification.targetRole !== null && notification.targetRole !== actor.role) {
    throw new DomainError(
      'FORBIDDEN_ROLE',
      403,
      'Acesso negado',
      'Notificação destinada a outro papel.'
    )
  }

  const updated = await withTransaction((tx) =>
    tx.notification.update({
      where: { id: notification.id },
      data: { readAt: notification.readAt ?? new Date() },
    })
  )

  const view: NotificationView = {
    id: updated.id,
    title: updated.title,
    body: updated.body,
    kind: updated.kind as NotificationView['kind'],
    module: updated.module ?? null,
    targetRole: (updated.targetRole as Role | null) ?? null,
    readAt: updated.readAt ? updated.readAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
  }
  return Response.json({ notification: view })
})
