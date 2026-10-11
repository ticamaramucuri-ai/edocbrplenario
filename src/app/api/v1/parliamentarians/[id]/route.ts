/**
 * PATCH|DELETE /api/v1/parliamentarians/:id
 * PATCH: atualização parcial (RBAC parliamentarian.write; auditoria com before/after).
 * DELETE: soft delete (active=false; auditoria parliamentarian.deactivated).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadParliamentarian } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { toParliamentarianView } from '@/lib/server/serializers'
import { isTenantImageUrl } from '@/lib/server/parliamentarian-images'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  party: z.string().min(1).max(20).optional(),
  bloc: z.string().max(60).nullable().optional(),
  boardRole: z.enum(['presidente', 'vice_presidente', 'primeiro_secretario', 'vereador']).optional(),
  committee: z.string().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  partyEmblemUrl: z.string().nullable().optional(),
  order: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'parliamentarian.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await loadParliamentarian(actor, id)
  if ((body.photoUrl !== current.photoUrl && !isTenantImageUrl(body.photoUrl, current.tenantId)) ||
      (body.partyEmblemUrl !== current.partyEmblemUrl && !isTenantImageUrl(body.partyEmblemUrl, current.tenantId))) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Imagem inválida', 'A imagem deve pertencer à Câmara atual.')
  }
  const updated = await withTransaction(async (tx) => {
    const parliamentarian = await tx.parliamentarian.update({
      where: { id: current.id },
      data: body,
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: 'parliamentarian.updated',
      aggregateType: 'parliamentarian',
      aggregateId: current.id,
      summary: `Parlamentar atualizado: ${parliamentarian.name}.`,
      before: {
        name: current.name,
        party: current.party,
        bloc: current.bloc,
        boardRole: current.boardRole,
        committee: current.committee,
        active: current.active,
        photoUrl: current.photoUrl,
        partyEmblemUrl: current.partyEmblemUrl,
      },
      after: {
        name: parliamentarian.name,
        party: parliamentarian.party,
        bloc: parliamentarian.bloc,
        boardRole: parliamentarian.boardRole,
        committee: parliamentarian.committee,
        active: parliamentarian.active,
        photoUrl: parliamentarian.photoUrl,
        partyEmblemUrl: parliamentarian.partyEmblemUrl,
      },
      correlationId,
      ip: clientIp(req),
    })
    return parliamentarian
  })

  return Response.json({ parliamentarian: toParliamentarianView(updated) })
})

export const DELETE = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'parliamentarian.write')
  const { id } = await ctx.params

  const current = await loadParliamentarian(actor, id)
  const updated = await withTransaction(async (tx) => {
    const parliamentarian = await tx.parliamentarian.update({
      where: { id: current.id },
      data: { active: false },
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: 'parliamentarian.deactivated',
      aggregateType: 'parliamentarian',
      aggregateId: current.id,
      summary: `Parlamentar desativado (soft delete): ${current.name}.`,
      before: { active: true },
      after: { active: false },
      correlationId,
      ip: clientIp(req),
    })
    return parliamentarian
  })

  return Response.json({ parliamentarian: toParliamentarianView(updated) })
})
