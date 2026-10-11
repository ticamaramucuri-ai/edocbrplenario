/** Convocação atual e ciência do próprio parlamentar vinculado. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requireMeParliamentarian } from '@/lib/server/me'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  sessionId: z.string().min(1),
  revision: z.number().int().positive(),
  noticeSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await resolveActor(req)
  const person = await requireMeParliamentarian(actor)
  const sessionId = new URL(req.url).searchParams.get('sessionId')
  if (!sessionId) throw new DomainError('VALIDATION_ERROR', 422, 'Sessão obrigatória', 'Informe sessionId.')
  const session = await db.session.findFirst({ where: { id: sessionId, tenantId: person.tenantId } })
  if (!session) throw notFound('Sessão não encontrada nesta Câmara.')
  const revision = await db.sessionAgendaRevision.findFirst({
    where: { sessionId, tenantId: person.tenantId, noticeSha256: { not: null } },
    orderBy: { revision: 'desc' },
  })
  if (!revision) return Response.json({ notice: null })
  const recipient = await db.sessionNoticeRecipient.findFirst({
    where: { tenantId: person.tenantId, sessionId, revision: revision.revision, parliamentarianId: person.id },
  })
  const content = revision.noticeJson ? JSON.parse(revision.noticeJson) as { tenant?: { slug?: string } } : null
  return Response.json({ notice: recipient ? {
    sessionId, revision: recipient.revision, noticeSha256: recipient.noticeSha256,
    issuedAt: recipient.issuedAt.toISOString(),
    acknowledgedAt: recipient.acknowledgedAt?.toISOString() ?? null,
    publicUrl: content?.tenant?.slug ? `/api/v1/public/sessions/${encodeURIComponent(sessionId)}/notices?tenant=${encodeURIComponent(content.tenant.slug)}&revision=${revision.revision}` : null,
  } : null })
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  const person = await requireMeParliamentarian(actor)
  const body = bodySchema.parse(await req.json())
  const result = await withTransaction(async (tx) => {
    const session = await tx.session.findFirst({ where: { id: body.sessionId, tenantId: person.tenantId } })
    if (!session) throw notFound('Sessão não encontrada nesta Câmara.')
    const latest = await tx.sessionAgendaRevision.findFirst({
      where: { tenantId: person.tenantId, sessionId: body.sessionId, noticeSha256: { not: null } },
      orderBy: { revision: 'desc' },
    })
    if (!latest || latest.revision !== body.revision || latest.noticeSha256 !== body.noticeSha256 || session.status === 'cancelled') {
      throw new DomainError('CONFLICT_VERSION', 409, 'Convocação alterada', 'A convocação mudou ou foi cancelada. Recarregue a sessão.')
    }
    const recipient = await tx.sessionNoticeRecipient.findFirst({ where: {
      tenantId: person.tenantId, sessionId: body.sessionId, revision: body.revision,
      parliamentarianId: person.id, noticeSha256: body.noticeSha256,
    } })
    if (!recipient) throw notFound('Você não consta entre os destinatários desta revisão.')
    if (recipient.acknowledgedAt) return recipient
    const at = new Date()
    const changed = await tx.sessionNoticeRecipient.updateMany({
      where: { id: recipient.id, acknowledgedAt: null },
      data: { acknowledgedAt: at, ackActorId: actor.id },
    })
    if (changed.count !== 1) return tx.sessionNoticeRecipient.findUniqueOrThrow({ where: { id: recipient.id } })
    await writeAudit(tx, { tenantId: person.tenantId, actor, action: 'notice.acknowledged',
      aggregateType: 'session', aggregateId: body.sessionId,
      summary: `Ciência da convocação, revisão ${body.revision}.`,
      after: { revision: body.revision, noticeSha256: body.noticeSha256, parliamentarianId: person.id },
      correlationId, ip: clientIp(req) })
    return { ...recipient, acknowledgedAt: at }
  })
  return Response.json({ notice: { sessionId: result.sessionId, revision: result.revision,
    noticeSha256: result.noticeSha256, acknowledgedAt: result.acknowledgedAt?.toISOString() ?? null } })
})
