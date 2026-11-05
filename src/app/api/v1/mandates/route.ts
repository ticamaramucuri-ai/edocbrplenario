/**
 * GET|POST /api/v1/mandates — mandatos por legislatura.
 * GET: filtros legislatureId / parliamentarianId. POST: RBAC structure.write
 * (único mandato por parlamentar+legislatura — @@unique).
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
import { toMandateView } from '@/lib/server/serializers'
import { legislatureLabel } from '@/lib/legislature-label'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const params = req.nextUrl.searchParams
  const legislatureId = params.get('legislatureId')?.trim()
  const parliamentarianId = params.get('parliamentarianId')?.trim()

  const mandates = await db.mandate.findMany({
    where: {
      tenantId,
      ...(legislatureId ? { legislatureId } : {}),
      ...(parliamentarianId ? { parliamentarianId } : {}),
    },
    include: { parliamentarian: true, legislature: true },
    orderBy: [{ legislatureId: 'desc' }, { parliamentarian: { order: 'asc' } }],
  })
  return Response.json({ mandates: mandates.map(toMandateView) })
})

const createSchema = z.object({
  parliamentarianId: z.string().min(1, 'Parlamentar obrigatório.'),
  legislatureId: z.string().min(1, 'Legislatura obrigatória.'),
  startDate: z.string().datetime({ offset: true, error: 'Data de início obrigatória.' }),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  votes: z.number().int().min(0).max(999999).nullable().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const parliamentarian = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
  if (!parliamentarian) throw notFound('Parlamentar não encontrado.')
  assertTenantScope(actor, parliamentarian.tenantId)
  const legislature = await db.legislature.findUnique({ where: { id: body.legislatureId } })
  if (!legislature) throw notFound('Legislatura não encontrada.')
  assertTenantScope(actor, legislature.tenantId)

  const mandate = await withTransaction(async (tx) => {
    const dup = await tx.mandate.findUnique({
      where: { parliamentarianId_legislatureId: { parliamentarianId: parliamentarian.id, legislatureId: legislature.id } },
      select: { id: true },
    })
    if (dup) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        `${parliamentarian.name} já possui mandato em ${legislatureLabel(legislature.number, legislature.startYear, legislature.endYear)}.`
      )
    }
    const created = await tx.mandate.create({
      data: {
        tenantId,
        parliamentarianId: parliamentarian.id,
        legislatureId: legislature.id,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        votes: body.votes ?? null,
      },
      include: { parliamentarian: true, legislature: true },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'mandate.create',
      aggregateType: 'mandate',
      aggregateId: created.id,
      summary: `Mandato de ${parliamentarian.name} em ${legislatureLabel(legislature.number, legislature.startYear, legislature.endYear)} registrado.`,
      after: { parliamentarian: parliamentarian.name, legislature: legislature.number, votes: created.votes },
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
        entity: 'mandate',
        event: 'created',
        id: created.id,
        parliamentarian: parliamentarian.name,
        legislature: legislature.number,
      },
    })
    return created
  })

  return Response.json({ mandate: toMandateView(mandate) }, { status: 201 })
})
