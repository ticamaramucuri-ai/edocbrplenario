/** Prévia operacional dos destinatários se uma revisão fosse publicada agora. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { tenantSettings } from '@/lib/server/domain'
import { eligibleNoticeRecipients } from '@/lib/server/session-notice-recipients'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: session.tenantId }, select: { settings: true } })
  const people = await db.$transaction((tx) => eligibleNoticeRecipients(tx, session.tenantId, id))
  return Response.json({ policy: tenantSettings(tenant).noticeRecipientPolicy, total: people.length, recipients: people })
})
