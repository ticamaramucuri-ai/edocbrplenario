/**
 * GET|POST /api/v1/committees — comissões do tenant.
 * GET: com contagem de membros com vigência aberta. POST: RBAC structure.write.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toCommitteeView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const committees = await db.committee.findMany({
    where: { tenantId },
    include: { _count: { select: { members: { where: { endDate: null } } } } },
    orderBy: { acronym: 'asc' },
  })
  return Response.json({
    committees: committees.map((c) => toCommitteeView(c, c._count.members)),
  })
})

const createSchema = z.object({
  name: z.string().min(4, 'Nome obrigatório.').max(140),
  acronym: z.string().min(2, 'Sigla obrigatória.').max(12),
  kind: z.enum(['permanente', 'temporaria', 'especial']).optional(),
  description: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const committee = await withTransaction(async (tx) => {
    const acronym = body.acronym.trim().toUpperCase()
    const dup = await tx.committee.findUnique({ where: { tenantId_acronym: { tenantId, acronym } } })
    if (dup) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Dados inválidos', `Comissão com sigla "${acronym}" já existe neste tenant.`)
    }
    const created = await tx.committee.create({
      data: {
        tenantId,
        name: body.name.trim(),
        acronym,
        kind: body.kind ?? 'permanente',
        description: body.description?.trim() ?? null,
        active: body.active ?? true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'committee.create',
      aggregateType: 'committee',
      aggregateId: created.id,
      summary: `Comissão criada: ${created.name} (${created.acronym}).`,
      after: { name: created.name, acronym: created.acronym, kind: created.kind },
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
      internalPayload: { entity: 'committee', event: 'created', id: created.id, acronym: created.acronym },
    })
    return created
  })

  return Response.json({ committee: toCommitteeView(committee, 0) }, { status: 201 })
})
