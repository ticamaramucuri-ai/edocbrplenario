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
  action: z.enum(['encerrar', 'transferir']),
  parliamentarianId: z.string().min(1).optional(), // obrigatório em transferir
  startDate: z.string().datetime({ offset: true }).optional(),
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

  if (current.endDate !== null) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Vigência encerrada',
      'Esta posição já possui vigência encerrada — o histórico não é alterado.'
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
