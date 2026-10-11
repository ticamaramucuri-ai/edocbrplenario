/**
 * PATCH /api/v1/blocs/:id — edição/soft delete (active). RBAC structure.write.
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
import { toBlocView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  partyAcronyms: z.array(z.string().min(1).max(10)).max(30).optional(),
  active: z.boolean().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.bloc.findUnique({ where: { id } })
  if (!current) throw notFound('Bloco não encontrado.')
  assertTenantScope(actor, current.tenantId)

  const bloc = await withTransaction(async (tx) => {
    const updated = await tx.bloc.update({
      where: { id: current.id },
      data: {
        name: body.name === undefined ? undefined : body.name.trim(),
        partyAcronyms: body.partyAcronyms === undefined ? undefined : JSON.stringify(body.partyAcronyms.map((a) => a.toUpperCase())),
        active: body.active ?? undefined,
      },
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: body.active === false ? 'bloc.deactivated' : 'bloc.update',
      aggregateType: 'bloc',
      aggregateId: current.id,
      summary: `Bloco ${updated.name} ${body.active === false ? 'desativado' : 'atualizado'}.`,
      before: { name: current.name, partyAcronyms: JSON.parse(current.partyAcronyms), active: current.active },
      after: { name: updated.name, partyAcronyms: JSON.parse(updated.partyAcronyms), active: updated.active },
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
      internalPayload: { entity: 'bloc', event: 'updated', id: current.id, name: updated.name, active: updated.active },
    })
    return updated
  })

  return Response.json({ bloc: toBlocView(bloc) })
})
