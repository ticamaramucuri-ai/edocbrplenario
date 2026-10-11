/**
 * GET|POST /api/v1/committees/:id/meetings — reuniões da comissão.
 * GET: agendadas e históricas (mais próximas primeiro). POST: agenda reunião.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toCommitteeMeetingView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const committee = await db.committee.findUnique({ where: { id } })
  if (!committee) throw notFound('Comissão não encontrada.')
  assertTenantScope(actor, committee.tenantId)

  const meetings = await db.committeeMeeting.findMany({
    where: { committeeId: committee.id },
    include: { committee: { select: { acronym: true } } },
    orderBy: { scheduledAt: 'desc' },
  })
  return Response.json({ meetings: meetings.map(toCommitteeMeetingView) })
})

const createSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true, error: 'Data/hora obrigatória.' }),
  subject: z.string().min(3, 'Assunto obrigatório.').max(200),
  notes: z.string().max(2000).optional(),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())

  const committee = await db.committee.findUnique({ where: { id } })
  if (!committee) throw notFound('Comissão não encontrada.')
  assertTenantScope(actor, committee.tenantId)

  const meeting = await withTransaction(async (tx) => {
    const created = await tx.committeeMeeting.create({
      data: {
        committeeId: committee.id,
        scheduledAt: new Date(body.scheduledAt),
        subject: body.subject.trim(),
        notes: body.notes?.trim() ?? null,
      },
      include: { committee: { select: { acronym: true } } },
    })
    await writeAudit(tx, {
      tenantId: committee.tenantId,
      actor,
      action: 'committee.meeting_scheduled',
      aggregateType: 'committee_meeting',
      aggregateId: created.id,
      summary: `Reunião da ${committee.acronym} agendada: ${created.subject}.`,
      after: { committee: committee.acronym, scheduledAt: created.scheduledAt, subject: created.subject },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: committee.tenantId,
      eventType: 'structure.changed',
      aggregateId: created.id,
      aggregateVersion: 1,
      correlationId,
      origin: 'operator',
      internalPayload: {
        entity: 'committee_meeting',
        event: 'scheduled',
        id: created.id,
        committee: committee.acronym,
        subject: created.subject,
        scheduledAt: created.scheduledAt.toISOString(),
      },
    })
    return created
  })

  return Response.json({ meeting: toCommitteeMeetingView(meeting) }, { status: 201 })
})
