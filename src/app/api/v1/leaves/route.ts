/**
 * GET|POST /api/v1/leaves — licenças/afastamentos/suplências.
 * GET: filtro opcional parliamentarianId; vigentes primeiro.
 * POST: RBAC structure.write; valida parlamentar e suplente (se informado).
 */
import type { NextRequest } from 'next/server'
import type { Parliamentarian } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toLeaveView } from '@/lib/server/serializers'
import { LEAVE_KIND_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const parliamentarianId = req.nextUrl.searchParams.get('parliamentarianId')?.trim()

  const leaves = await db.leave.findMany({
    where: { tenantId, ...(parliamentarianId ? { parliamentarianId } : {}) },
    include: { parliamentarian: true, substitute: true },
    orderBy: [{ endDate: 'desc' }, { startDate: 'desc' }],
  })
  // Vigentes (endDate null) primeiro, depois por data de início desc.
  const vigentes = leaves.filter((l) => l.endDate === null)
  const encerradas = leaves.filter((l) => l.endDate !== null)
  return Response.json({ leaves: [...vigentes, ...encerradas].map(toLeaveView) })
})

const createSchema = z.object({
  parliamentarianId: z.string().min(1, 'Parlamentar obrigatório.'),
  kind: z.enum(['licenca', 'afastamento', 'suplencia']),
  startDate: z.string().datetime({ offset: true, error: 'Data de início obrigatória.' }),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().min(3, 'Motivo obrigatório.').max(500),
  substituteId: z.string().nullable().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const parliamentarian = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
  if (!parliamentarian) throw notFound('Parlamentar não encontrado.')
  assertTenantScope(actor, parliamentarian.tenantId)
  let substitute: Parliamentarian | null = null
  if (body.substituteId) {
    substitute = await db.parliamentarian.findUnique({ where: { id: body.substituteId } })
    if (!substitute) throw notFound('Suplente (parlamentar) não encontrado.')
    assertTenantScope(actor, substitute.tenantId)
  }

  const leave = await withTransaction(async (tx) => {
    const open = await tx.leave.findFirst({
      where: { parliamentarianId: parliamentarian.id, endDate: null },
      select: { id: true },
    })
    if (open) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Afastamento vigente',
        `${parliamentarian.name} já possui afastamento com vigência aberta. Encerre o registro atual antes.`
      )
    }
    const created = await tx.leave.create({
      data: {
        tenantId,
        parliamentarianId: parliamentarian.id,
        kind: body.kind,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        reason: body.reason.trim(),
        substituteId: substitute?.id ?? null,
      },
      include: { parliamentarian: true, substitute: true },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'leave.create',
      aggregateType: 'leave',
      aggregateId: created.id,
      summary: `${LEAVE_KIND_LABEL[created.kind]} registrada: ${parliamentarian.name}${
        substitute ? ` (suplente: ${substitute.name})` : ''
      }.`,
      after: {
        parliamentarian: parliamentarian.name,
        kind: created.kind,
        startDate: created.startDate,
        endDate: created.endDate,
        substitute: substitute?.name ?? null,
      },
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
        entity: 'leave',
        event: 'created',
        id: created.id,
        parliamentarian: parliamentarian.name,
        kind: created.kind,
      },
    })
    return created
  })

  return Response.json({ leave: toLeaveView(leave) }, { status: 201 })
})
