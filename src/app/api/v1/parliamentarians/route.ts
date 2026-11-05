/**
 * GET|POST /api/v1/parliamentarians — cadastro de parlamentares
 * (GET lista ativos+inativos por ordem de bancada; POST RBAC parliamentarian.write).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { toParliamentarianView } from '@/lib/server/serializers'
import { isTenantImageUrl } from '@/lib/server/parliamentarian-images'
import { partyEmblem, setPartyEmblem } from '@/lib/server/party-emblems'
import { emitOutbox } from '@/lib/server/outbox'
import { DomainError } from '@/lib/server/errors'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const parliamentarians = await db.parliamentarian.findMany({
    where: { tenantId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
  return Response.json({ parliamentarians: parliamentarians.map(toParliamentarianView) })
})

const createSchema = z.object({
  name: z.string().min(3, 'Nome obrigatório.').max(120),
  party: z.string().min(1, 'Partido obrigatório.').max(20),
  bloc: z.string().max(60).optional(),
  boardRole: z.enum(['presidente', 'vice_presidente', 'primeiro_secretario', 'segundo_secretario', 'vereador']).optional(),
  committee: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  photoUrl: z.string().nullable().optional(),
  partyEmblemUrl: z.string().nullable().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'parliamentarian.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())
  if (!isTenantImageUrl(body.photoUrl, tenantId) || !isTenantImageUrl(body.partyEmblemUrl, tenantId)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Imagem inválida', 'A imagem deve pertencer à Câmara atual.')
  }

  const created = await withTransaction(async (tx) => {
    const party = body.party.trim().toUpperCase()
    if (body.partyEmblemUrl) {
      const updatedParty = await setPartyEmblem(tx, tenantId, party, body.partyEmblemUrl)
      await writeAudit(tx, { tenantId, actor, action: 'party.emblem_updated', aggregateType: 'party', aggregateId: updatedParty.id,
        summary: `Emblema do partido ${party} atualizado.`, after: { emblemUrl: body.partyEmblemUrl }, correlationId, ip: clientIp(req) })
      await emitOutbox(tx, { tenantId, eventType: 'structure.changed', aggregateId: updatedParty.id, aggregateVersion: 1,
        correlationId, origin: 'operator', internalPayload: { entity: 'party', event: 'emblem_updated', id: updatedParty.id } })
    }
    const emblem = body.partyEmblemUrl || await partyEmblem(tx, tenantId, party)
    const last = await tx.parliamentarian.findFirst({
      where: { tenantId },
      orderBy: { order: 'desc' },
      select: { order: true },
    })
    const parliamentarian = await tx.parliamentarian.create({
      data: {
        tenantId,
        name: body.name,
        party,
        bloc: body.bloc ?? null,
        boardRole: body.boardRole ?? 'vereador',
        committee: body.committee ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        photoUrl: body.photoUrl ?? null,
        partyEmblemUrl: emblem,
        order: (last?.order ?? -1) + 1,
        active: true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'parliamentarian.created',
      aggregateType: 'parliamentarian',
      aggregateId: parliamentarian.id,
      summary: `Parlamentar cadastrado: ${parliamentarian.name} (${parliamentarian.party}).`,
      after: { name: parliamentarian.name, party: parliamentarian.party, boardRole: parliamentarian.boardRole, photoUrl: parliamentarian.photoUrl, partyEmblemUrl: parliamentarian.partyEmblemUrl },
      correlationId,
      ip: clientIp(req),
    })
    return parliamentarian
  })

  return Response.json({ parliamentarian: toParliamentarianView(created) }, { status: 201 })
})
