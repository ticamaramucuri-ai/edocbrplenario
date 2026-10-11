/**
 * PATCH /api/v1/parties/:id — edição/soft delete (active=false). RBAC structure.write.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toPartyView } from '@/lib/server/serializers'
import { isTenantImageUrl } from '@/lib/server/parliamentarian-images'
import { setPartyEmblem } from '@/lib/server/party-emblems'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(4).max(120).optional(),
  number: z.number().int().min(0).max(999).nullable().optional(),
  active: z.boolean().optional(),
  emblemUrl: z.string().nullable().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.party.findUnique({ where: { id } })
  if (!current) throw notFound('Partido não encontrado.')
  assertTenantScope(actor, current.tenantId)
  if (!isTenantImageUrl(body.emblemUrl, current.tenantId)) throw new DomainError('VALIDATION_ERROR', 422, 'Imagem inválida', 'A imagem deve pertencer à Câmara atual.')

  const party = await withTransaction(async (tx) => {
    const updated = await tx.party.update({
      where: { id: current.id },
      data: {
        name: body.name === undefined ? undefined : body.name.trim(),
        number: body.number === undefined ? undefined : body.number,
        active: body.active ?? undefined,
        emblemUrl: body.emblemUrl === undefined ? undefined : body.emblemUrl,
      },
    })
    if (body.emblemUrl !== undefined && body.emblemUrl !== current.emblemUrl) {
      await setPartyEmblem(tx, current.tenantId, current.acronym, body.emblemUrl)
    }
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: body.active === false ? 'party.deactivated' : body.active === true ? 'party.reactivated' : 'party.update',
      aggregateType: 'party',
      aggregateId: current.id,
      summary: `Partido ${updated.acronym} ${body.active === false ? 'desativado' : 'atualizado'}.`,
      before: { name: current.name, number: current.number, active: current.active, emblemUrl: current.emblemUrl },
      after: { name: updated.name, number: updated.number, active: updated.active, emblemUrl: updated.emblemUrl },
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
      internalPayload: { entity: 'party', event: 'updated', id: current.id, acronym: updated.acronym, active: updated.active },
    })
    return updated
  })

  return Response.json({ party: toPartyView(party) })
})
