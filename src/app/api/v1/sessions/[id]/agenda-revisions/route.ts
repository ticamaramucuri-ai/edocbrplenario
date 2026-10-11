/** GET /api/v1/sessions/:id/agenda-revisions — histórico de publicação, isolado por Câmara. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const revisions = await db.sessionAgendaRevision.findMany({
    where: { sessionId: session.id, tenantId: session.tenantId },
    orderBy: { revision: 'asc' },
  })
  return Response.json({ revisions: revisions.map((revision) => ({
    id: revision.id,
    number: revision.revision,
    createdAt: revision.createdAt.toISOString(),
    actorId: revision.actorId,
    agenda: JSON.parse(revision.agendaJson),
    policy: JSON.parse(revision.policyJson),
    documents: JSON.parse(revision.documentManifestJson),
    change: revision.changeJson ? JSON.parse(revision.changeJson) : null,
    justification: revision.justification,
    notice: revision.noticeJson ? JSON.parse(revision.noticeJson) : null,
    noticeSha256: revision.noticeSha256,
  })) })
})
