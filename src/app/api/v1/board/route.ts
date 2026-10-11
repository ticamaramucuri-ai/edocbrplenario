/**
 * GET|POST /api/v1/board — Mesa Diretora (composição com vigência).
 * GET: posições com dados do parlamentar + legislatura (mais recentes primeiro).
 * POST: designar (RBAC structure.write) — valida legislatura e parlamentar.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toBoardPositionView } from '@/lib/server/serializers'
import { BOARD_ROLE_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const legislatureId = req.nextUrl.searchParams.get('legislatureId')?.trim()
  const positions = await db.boardPosition.findMany({
    where: { tenantId, ...(legislatureId ? { legislatureId } : {}) },
    include: { parliamentarian: true, legislature: true },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
  })
  return Response.json({ board: positions.map(toBoardPositionView) })
})

const createSchema = z.object({
  legislatureId: z.string().min(1, 'Legislatura obrigatória.'),
  role: z.enum(['presidente', 'vice_presidente', 'primeiro_secretario', 'segundo_secretario']),
  parliamentarianId: z.string().min(1, 'Parlamentar obrigatório.'),
  startDate: z.string().datetime({ offset: true }).optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  // Valida existência da legislatura e do parlamentar (escopo de tenant).
  const legislature = await db.legislature.findUnique({ where: { id: body.legislatureId } })
  if (!legislature) throw notFound('Legislatura não encontrada.')
  assertTenantScope(actor, legislature.tenantId)
  const parliamentarian = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
  if (!parliamentarian) throw notFound('Parlamentar não encontrado.')
  assertTenantScope(actor, parliamentarian.tenantId)

  const position = await withTransaction(async (tx) => {
    // Cargo com vigência aberta para a mesma legislatura? Bloqueia duplicidade.
    const openSameRole = await tx.boardPosition.findFirst({
      where: { tenantId, legislatureId: legislature.id, role: body.role, endDate: null },
      select: { id: true, parliamentarian: { select: { name: true } } },
    })
    if (openSameRole) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Cargo ocupado',
        `O cargo de ${BOARD_ROLE_LABEL[body.role]} já possui vigência aberta (${openSameRole.parliamentarian.name}). Encerre ou transfira antes de designar.`
      )
    }
    const created = await tx.boardPosition.create({
      data: {
        tenantId,
        legislatureId: legislature.id,
        role: body.role,
        parliamentarianId: parliamentarian.id,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
      },
      include: { parliamentarian: true, legislature: true },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'board.designated',
      aggregateType: 'board_position',
      aggregateId: created.id,
      summary: `${BOARD_ROLE_LABEL[body.role]}: ${parliamentarian.name} designado na Legislatura nº ${legislature.number}.`,
      after: { role: created.role, parliamentarian: parliamentarian.name, legislatureId: legislature.id, startDate: created.startDate },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId,
      eventType: 'structure.changed',
      aggregateId: created.id,
      aggregateVersion: 1,
      correlationId,
      origin: 'operator',
      internalPayload: {
        entity: 'board_position',
        event: 'designated',
        id: created.id,
        role: created.role,
        parliamentarian: parliamentarian.name,
      },
    })
    return created
  })

  return Response.json({ position: toBoardPositionView(position) }, { status: 201 })
})
