/**
 * PATCH /api/v1/board/:id — encerrar vigência (endDate=now) ou transferir cargo
 * (encerra a vigência atual e designa novo parlamentar no mesmo cargo/legislatura).
 * RBAC structure.write. Histórico nunca é apagado (append-only temporal).
 */
import type { NextRequest } from 'next/server'
import type { Parliamentarian } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toBoardPositionView } from '@/lib/server/serializers'
import { BOARD_ROLE_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  action: z.enum(['encerrar', 'transferir', 'confirmar_posse']),
  parliamentarianId: z.string().min(1).optional(), // obrigatório em transferir
  startDate: z.string().datetime({ offset: true }).optional(),
  confirmationReference: z.string().min(5).max(200).optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.boardPosition.findUnique({
    where: { id },
    include: { parliamentarian: true, legislature: true },
  })
  if (!current) throw notFound('Posição na Mesa Diretora não encontrada.')
  assertTenantScope(actor, current.tenantId)

  if (body.action === 'confirmar_posse') {
    const confirmationReference = body.confirmationReference?.trim()
    if (current.status !== 'elected' || !confirmationReference) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Posse não confirmada',
        'A posição deve estar eleita e a referência do ato de posse deve ser informada.')
    }
    const startDate = body.startDate ? new Date(body.startDate) : current.startDate
    if (startDate > new Date()) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Data futura', 'A posse só pode ser confirmada após a data efetiva.')
    }
    const confirmed = await withTransaction(async (tx) => {
      const overlap = await tx.boardPosition.findFirst({ where: {
        tenantId: current.tenantId, legislatureId: current.legislatureId, role: current.role,
        id: { not: current.id }, status: 'confirmed',
        startDate: { lte: current.endDate ?? undefined },
        OR: [{ endDate: null }, { endDate: { gte: startDate } }],
      }, select: { id: true } })
      if (overlap) throw new DomainError('VALIDATION_ERROR', 409, 'Vigência sobreposta', 'Encerre a composição anterior antes de confirmar a posse.')
      await tx.parliamentarian.updateMany({ where: {
        tenantId: current.tenantId, boardRole: current.role, id: { not: current.parliamentarianId },
      }, data: { boardRole: 'vereador' } })
      await tx.parliamentarian.update({ where: { id: current.parliamentarianId }, data: { boardRole: current.role } })
      const updated = await tx.boardPosition.update({ where: { id: current.id },
        data: { status: 'confirmed', startDate }, include: { parliamentarian: true, legislature: true } })
      await writeAudit(tx, { tenantId: current.tenantId, actor, action: 'board.inaugurated',
        aggregateType: 'board_position', aggregateId: current.id,
        summary: `Posse confirmada: ${BOARD_ROLE_LABEL[current.role]} ${current.parliamentarian.name}.`,
        before: { status: current.status, startDate: current.startDate },
        after: { status: updated.status, startDate: updated.startDate },
        justification: confirmationReference, correlationId, ip: clientIp(req) })
      await emitOutbox(tx, { tenantId: current.tenantId, eventType: 'structure.changed',
        aggregateId: current.id, aggregateVersion: 2, correlationId, origin: 'operator',
        internalPayload: { entity: 'board_position', event: 'inaugurated', id: current.id } })
      return updated
    })
    return Response.json({ position: toBoardPositionView(confirmed) })
  }

  if (current.startDate > new Date() || (current.endDate !== null && current.endDate < new Date())) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Vigência encerrada',
      'Esta posição não está vigente; o histórico e as designações futuras não são alterados por esta ação.'
    )
  }
  if (body.action === 'transferir' && !body.parliamentarianId) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Transferência exige o parlamentar que assumirá o cargo.',
      { errors: { parliamentarianId: ['Informe o novo ocupante do cargo.'] } }
    )
  }

  let successor: Parliamentarian | null = null
  if (body.action === 'transferir' && body.parliamentarianId) {
    successor = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
    if (!successor) throw notFound('Parlamentar substituto não encontrado.')
    assertTenantScope(actor, successor.tenantId)
    if (successor.id === current.parliamentarianId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Transferência para o mesmo parlamentar não altera a composição.'
      )
    }
  }

  const now = new Date()
  const result = await withTransaction(async (tx) => {
    const closed = await tx.boardPosition.update({
      where: { id: current.id },
      data: { endDate: now },
      include: { parliamentarian: true, legislature: true },
    })
    const created = body.action === 'transferir' && successor
      ? await tx.boardPosition.create({
        data: {
          tenantId: current.tenantId,
          legislatureId: current.legislatureId,
          role: current.role,
          parliamentarianId: successor.id,
          startDate: body.startDate ? new Date(body.startDate) : now,
          endDate: current.endDate,
        },
        include: { parliamentarian: true, legislature: true },
      })
      : null
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: body.action === 'transferir' ? 'board.transfer' : 'board.end',
      aggregateType: 'board_position',
      aggregateId: current.id,
      summary:
        body.action === 'transferir' && created
          ? `${BOARD_ROLE_LABEL[current.role]}: ${current.parliamentarian.name} → ${successor!.name}.`
          : `Vigência encerrada: ${BOARD_ROLE_LABEL[current.role]} ${current.parliamentarian.name}.`,
      before: { role: current.role, parliamentarian: current.parliamentarian.name, endDate: null },
      after: {
        role: current.role,
        parliamentarian: current.parliamentarian.name,
        endDate: now.toISOString(),
        successor: created ? { name: successor!.name, positionId: created.id } : null,
      },
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
        entity: 'board_position',
        event: body.action === 'transferir' ? 'transfer' : 'end',
        id: current.id,
        role: current.role,
        from: current.parliamentarian.name,
        to: successor?.name ?? null,
      },
    })
    return { closed, created }
  })

  return Response.json({
    position: toBoardPositionView(result.closed),
    successor: result.created ? toBoardPositionView(result.created) : null,
  })
})
