/**
 * POST /api/v1/notifications/read-all — marca TODAS as notificações visíveis
 * ao ator (targetRole null ou = papel do ator, unread) como lidas.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)

  const result = await withTransaction((tx) =>
    tx.notification.updateMany({
      where: {
        tenantId,
        OR: [{ targetRole: actor.role }, { targetRole: null }],
        readAt: null,
      },
      data: { readAt: new Date() },
    })
  )

  return Response.json({ updated: result.count })
})
