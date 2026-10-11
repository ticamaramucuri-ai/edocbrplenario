/**
 * PATCH /api/v1/committee-members/:id — encerrar vigência de membro (saída da
 * comissão; histórico preservado). RBAC structure.write.
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
import { toCommitteeMemberView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  endDate: z.string().datetime({ offset: true }).optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.committeeMember.findUnique({
    where: { id },
    include: { committee: true, parliamentarian: true },
  })
  if (!current) throw notFound('Membro de comissão não encontrado.')
  const committee = current.committee
  if (actor.tenantId && committee.tenantId !== actor.tenantId && !actor.isPlatform) {
    throw notFound('Membro de comissão não encontrado.')
  }

  if (current.endDate !== null) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Vigência encerrada', 'Este vínculo com a comissão já está encerrado.')
  }

  const member = await withTransaction(async (tx) => {
    const now = body.endDate ? new Date(body.endDate) : new Date()
    const updated = await tx.committeeMember.update({
      where: { id: current.id },
      data: { endDate: now },
      include: { parliamentarian: true },
    })
    await writeAudit(tx, {
      tenantId: committee.tenantId,
      actor,
      action: 'committee.member_removed',
      aggregateType: 'committee',
      aggregateId: committee.id,
      summary: `${current.parliamentarian.name} deixou a ${committee.acronym} (vigência encerrada).`,
      before: { parliamentarian: current.parliamentarian.name, endDate: null },
      after: { parliamentarian: current.parliamentarian.name, endDate: now.toISOString() },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: committee.tenantId,
      eventType: 'structure.changed',
      aggregateId: committee.id,
      aggregateVersion: 3,
      correlationId,
      origin: 'operator',
      internalPayload: {
        entity: 'committee_member',
        event: 'removed',
        committeeId: committee.id,
        committee: committee.acronym,
        parliamentarian: current.parliamentarian.name,
      },
    })
    return updated
  })

  return Response.json({ member: toCommitteeMemberView(member) })
})
