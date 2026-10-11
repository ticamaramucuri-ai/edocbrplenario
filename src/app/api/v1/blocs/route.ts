/**
 * GET|POST /api/v1/blocs — blocos parlamentares do tenant.
 * POST: RBAC structure.write; partyAcronyms = JSON array de siglas.
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
import { toBlocView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const blocs = await db.bloc.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  })
  return Response.json({ blocs: blocs.map(toBlocView) })
})

const createSchema = z.object({
  name: z.string().min(3, 'Nome obrigatório.').max(120),
  partyAcronyms: z.array(z.string().min(1).max(10)).max(30).optional(),
  active: z.boolean().optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const bloc = await withTransaction(async (tx) => {
    const name = body.name.trim()
    const dup = await tx.bloc.findUnique({ where: { tenantId_name: { tenantId, name } } })
    if (dup) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Dados inválidos', `Bloco "${name}" já cadastrado neste tenant.`)
    }
    const acronyms = (body.partyAcronyms ?? []).map((a) => a.trim().toUpperCase()).filter(Boolean)
    const created = await tx.bloc.create({
      data: {
        tenantId,
        name,
        partyAcronyms: JSON.stringify(acronyms),
        active: body.active ?? true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'bloc.create',
      aggregateType: 'bloc',
      aggregateId: created.id,
      summary: `Bloco criado: ${created.name} (${acronyms.join(', ') || 'sem partidos'}).`,
      after: { name: created.name, partyAcronyms: acronyms },
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
      internalPayload: { entity: 'bloc', event: 'created', id: created.id, name: created.name },
    })
    return created
  })

  return Response.json({ bloc: toBlocView(bloc) }, { status: 201 })
})
