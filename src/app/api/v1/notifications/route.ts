/**
 * GET  /api/v1/notifications?unread=true&limit=50 — notificações do ator
 * (targetRole = papel do ator OU null), com unreadCount.
 * POST /api/v1/notifications — broadcast manual (apenas tenant_admin):
 * {title, body, kind, module?, targetRole?}. Auditoria `notification.broadcast`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { notify } from '@/lib/server/notify'
import { MODULE_IDS, type NotificationView, type Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

function toNotificationView(n: {
  id: string
  title: string
  body: string
  kind: string
  module: string | null
  targetRole: string | null
  readAt: Date | null
  createdAt: Date
}): NotificationView {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    kind: n.kind as NotificationView['kind'],
    module: n.module ?? null,
    targetRole: (n.targetRole as Role | null) ?? null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }
}

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const params = req.nextUrl.searchParams
  const unread = params.get('unread')?.trim() === 'true'
  const limit = Math.min(Math.max(parseInt(params.get('limit')?.trim() || '50', 10) || 50, 1), 200)

  const visible = {
    tenantId,
    OR: [{ targetRole: actor.role }, { targetRole: null }],
    ...(unread ? { readAt: null } : {}),
  }

  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: visible,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.notification.count({
      where: { tenantId, OR: [{ targetRole: actor.role }, { targetRole: null }], readAt: null },
    }),
  ])

  return Response.json({
    notifications: rows.map(toNotificationView),
    unreadCount,
  })
})

const broadcastSchema = z.object({
  title: z.string().min(3, 'Título obrigatório.').max(140),
  body: z.string().min(3, 'Mensagem obrigatória.').max(1000),
  kind: z.enum(['session', 'voting', 'task', 'webhook', 'system']).default('system'),
  module: z.enum(MODULE_IDS).optional().nullable(),
  targetRole: z
    .enum([
      'platform_owner',
      'platform_support',
      'tenant_admin',
      'legislative_admin',
      'session_operator',
      'presiding_officer',
      'parliamentarian',
      'auditor',
    ])
    .optional()
    .nullable(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'notification.broadcast')
  const tenantId = await resolveTenantScope(req, actor)
  const body = broadcastSchema.parse(await req.json())

  const created = await withTransaction(async (tx) => {
    const notification = await notify(tx, {
      tenantId,
      title: body.title.trim(),
      body: body.body.trim(),
      kind: body.kind,
      module: body.module ?? null,
      targetRole: body.targetRole ?? null,
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'notification.broadcast',
      aggregateType: 'notification',
      aggregateId: notification.id,
      summary: `Notificação manual enviada: "${notification.title}"${
        notification.targetRole ? ` (destino: ${notification.targetRole})` : ' (todos os papéis)'
      }.`,
      after: { title: notification.title, kind: notification.kind, targetRole: notification.targetRole },
      correlationId,
      ip: clientIp(req),
    })
    return notification
  })

  return Response.json({ notification: toNotificationView(created) }, { status: 201 })
})
