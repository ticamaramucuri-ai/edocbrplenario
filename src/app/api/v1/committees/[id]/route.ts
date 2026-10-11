/**
 * PATCH /api/v1/committees/:id — ativa/desativa e edita dados da comissão.
 * RBAC structure.write. Nunca exclui (histórico preservado).
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
import { toCommitteeView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(4).max(140).optional(),
  description: z.string().max(500).nullable().optional(),
  kind: z.enum(['permanente', 'temporaria', 'especial']).optional(),
  active: z.boolean().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.committee.findUnique({
    where: { id },
    include: { _count: { select: { members: { where: { endDate: null } } } } },
  })
  if (!current) throw notFound('Comissão não encontrada.')
  assertTenantScope(actor, current.tenantId)

  const committee = await withTransaction(async (tx) => {
    const updated = await tx.committee.update({
      where: { id: current.id },
      data: {
        name: body.name === undefined ? undefined : body.name.trim(),
        description: body.description === undefined ? undefined : body.description?.trim() ?? null,
        kind: body.kind ?? undefined,
        active: body.active ?? undefined,
      },
      include: { _count: { select: { members: { where: { endDate: null } } } } },
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action:
        body.active === false ? 'committee.deactivated' : body.active === true ? 'committee.reactivated' : 'committee.update',
      aggregateType: 'committee',
      aggregateId: current.id,
      summary: `Comissão ${updated.acronym} ${body.active === false ? 'desativada' : 'atualizada'}.`,
      before: { name: current.name, kind: current.kind, active: current.active },
      after: { name: updated.name, kind: updated.kind, active: updated.active },
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
      internalPayload: { entity: 'committee', event: 'updated', id: current.id, acronym: updated.acronym, active: updated.active },
    })
    return updated
  })

  return Response.json({ committee: toCommitteeView(committee, committee._count.members) })
})
