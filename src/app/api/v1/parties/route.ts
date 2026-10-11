/**
 * GET|POST /api/v1/parties — partidos políticos do tenant.
 * GET: sigla asc. POST: RBAC structure.write (sigla única por tenant).
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
import { toPartyView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const parties = await db.party.findMany({
    where: { tenantId },
    orderBy: { acronym: 'asc' },
  })
  return Response.json({ parties: parties.map(toPartyView) })
})

const createSchema = z.object({
  acronym: z.string().min(2, 'Sigla obrigatória (2–10 caracteres).').max(10),
  name: z.string().min(4, 'Nome obrigatório.').max(120),
  number: z.number().int().min(0).max(999).nullable().optional(),
  active: z.boolean().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const party = await withTransaction(async (tx) => {
    const acronym = body.acronym.trim().toUpperCase()
    const dup = await tx.party.findUnique({ where: { tenantId_acronym: { tenantId, acronym } } })
    if (dup) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Dados inválidos', `Partido "${acronym}" já cadastrado neste tenant.`)
    }
    const created = await tx.party.create({
      data: {
        tenantId,
        acronym,
        name: body.name.trim(),
        number: body.number ?? null,
        active: body.active ?? true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'party.create',
      aggregateType: 'party',
      aggregateId: created.id,
      summary: `Partido cadastrado: ${created.acronym} — ${created.name}.`,
      after: { acronym: created.acronym, name: created.name, number: created.number },
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
      internalPayload: { entity: 'party', event: 'created', id: created.id, acronym: created.acronym },
    })
    return created
  })

  return Response.json({ party: toPartyView(party) }, { status: 201 })
})
