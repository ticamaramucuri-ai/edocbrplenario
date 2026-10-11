/**
 * PATCH /api/v1/committee-meetings/:id — marcar reunião como realizada ou
 * cancelada (com notas opcionais). RBAC structure.write. Cancelamento exige
 * justificativa (registrada na auditoria).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toCommitteeMeetingView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  status: z.enum(['realizada', 'cancelada']),
  notes: z.string().max(2000).optional(),
  justification: z.string().min(5, 'Justificativa obrigatória para cancelar.').optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.committeeMeeting.findUnique({ where: { id }, include: { committee: true } })
  if (!current) throw notFound('Reunião não encontrada.')
  if (actor.tenantId && current.committee.tenantId !== actor.tenantId && !actor.isPlatform) {
    throw notFound('Reunião não encontrada.')
  }
  if (current.status === 'cancelada') {
    throw new DomainError('VALIDATION_ERROR', 422, 'Reunião cancelada', 'Reunião já cancelada não muda de status.')
  }
  if (body.status === 'cancelada' && !body.justification) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Cancelamento de reunião exige justificativa.',
      { errors: { justification: ['Informe a justificativa do cancelamento.'] } }
    )
  }

  const meeting = await withTransaction(async (tx) => {
    const updated = await tx.committeeMeeting.update({
      where: { id: current.id },
      data: {
        status: body.status,
        notes: body.notes === undefined ? undefined : body.notes?.trim() ?? null,
      },
      include: { committee: { select: { acronym: true } } },
    })
    await writeAudit(tx, {
      tenantId: current.committee.tenantId,
      actor,
      action: body.status === 'realizada' ? 'committee.meeting_held' : 'committee.meeting_cancelled',
      aggregateType: 'committee_meeting',
      aggregateId: current.id,
      summary: `Reunião da ${current.committee.acronym} (${current.subject.slice(0, 60)}) marcada como ${body.status}.`,
      before: { status: current.status },
      after: { status: updated.status },
      justification: body.status === 'cancelada' ? body.justification : null,
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: current.committee.tenantId,
      eventType: 'structure.changed',
      aggregateId: current.id,
      aggregateVersion: 2,
      correlationId,
      origin: 'operator',
      internalPayload: {
        entity: 'committee_meeting',
        event: body.status === 'realizada' ? 'held' : 'cancelled',
        id: current.id,
        committee: current.committee.acronym,
        subject: current.subject,
      },
    })
    return updated
  })

  return Response.json({ meeting: toCommitteeMeetingView(meeting) })
})
