/** Acompanhamento interno da ciência da revisão atual da convocação. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const revision = await db.sessionAgendaRevision.findFirst({
    where: { tenantId: session.tenantId, sessionId: id, noticeSha256: { not: null } },
    orderBy: { revision: 'desc' },
  })
  if (!revision) return Response.json({ revision: null, recipients: [], total: 0, acknowledged: 0 })
  const rows = await db.sessionNoticeRecipient.findMany({
    where: { tenantId: session.tenantId, sessionId: id, revision: revision.revision },
    orderBy: [{ recipientName: 'asc' }, { parliamentarianId: 'asc' }],
  })
  return Response.json({ revision: revision.revision, noticeSha256: revision.noticeSha256,
    total: rows.length, acknowledged: rows.filter((row) => row.acknowledgedAt).length,
    recipients: rows.map((row) => ({ parliamentarianId: row.parliamentarianId,
      name: row.recipientName, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null })) })
})
