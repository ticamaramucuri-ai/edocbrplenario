/**
 * PATCH /api/v1/leaves/:id — encerrar vigência (endDate=now) ou estender
 * (novo endDate informado). RBAC structure.write. Histórico preservado.
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
import { toLeaveView } from '@/lib/server/serializers'
import { LEAVE_KIND_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  action: z.enum(['encerrar', 'estender']),
  endDate: z.string().datetime({ offset: true }).optional(), // obrigatório em estender
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.leave.findUnique({
    where: { id },
    include: { parliamentarian: true, substitute: true },
  })
  if (!current) throw notFound('Afastamento não encontrado.')
  if (actor.tenantId && current.tenantId !== actor.tenantId && !actor.isPlatform) {
    throw notFound('Afastamento não encontrado.')
  }

  if (current.endDate !== null) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Vigência encerrada', 'Este afastamento já está encerrado.')
  }
  if (body.action === 'estender') {
    if (!body.endDate) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Extensão exige a nova data final.',
        { errors: { endDate: ['Informe a nova data final.'] } }
      )
    }
    const novaData = new Date(body.endDate)
    if (novaData.getTime() <= current.startDate.getTime()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Nova data final deve ser posterior ao início do afastamento.'
      )
    }
  }

  const leave = await withTransaction(async (tx) => {
    const now = new Date()
    const updated = await tx.leave.update({
      where: { id: current.id },
      data: { endDate: body.action === 'encerrar' ? now : new Date(body.endDate!) },
      include: { parliamentarian: true, substitute: true },
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: body.action === 'encerrar' ? 'leave.ended' : 'leave.extended',
      aggregateType: 'leave',
      aggregateId: current.id,
      summary: `${LEAVE_KIND_LABEL[current.kind]} de ${current.parliamentarian.name} ${
        body.action === 'encerrar' ? 'encerrada' : 'estendida'
      }.`,
      before: { endDate: current.endDate },
      after: { endDate: updated.endDate },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: current.tenantId,
      eventType: 'structure.changed',
      aggregateId: current.id,
      aggregateVersion: 2,
      correlationId,
      origin: 'operator',
      internalPayload: {
        entity: 'leave',
        event: body.action === 'encerrar' ? 'ended' : 'extended',
        id: current.id,
        parliamentarian: current.parliamentarian.name,
      },
    })
    return updated
  })

  return Response.json({ leave: toLeaveView(leave) })
})
