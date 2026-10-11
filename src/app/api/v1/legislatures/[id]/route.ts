/**
 * PATCH /api/v1/legislatures/:id — editar datas/número e marcar como atual
 * (desmarca as demais do tenant na mesma transação). Legislaturas NUNCA são
 * excluídas (histórico temporal preservado). RBAC structure.write.
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
import { toLegislatureView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  number: z.number().int().min(1).max(999).optional(),
  startYear: z.number().int().min(1990).max(2100).optional(),
  endYear: z.number().int().min(1990).max(2100).optional(),
  current: z.boolean().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.legislature.findUnique({ where: { id } })
  if (!current) throw notFound('Legislatura não encontrada.')
  assertTenantScope(actor, current.tenantId)

  const updated = await withTransaction(async (tx) => {
    if (body.current) {
      await tx.legislature.updateMany({
        where: { tenantId: current.tenantId, id: { not: current.id } },
        data: { current: false },
      })
    }
    const legislature = await tx.legislature.update({
      where: { id: current.id },
      data: {
        number: body.number ?? undefined,
        startYear: body.startYear ?? undefined,
        endYear: body.endYear ?? undefined,
        current: body.current ?? undefined,
      },
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: body.current ? 'legislature.set_current' : 'legislature.updated',
      aggregateType: 'legislature',
      aggregateId: current.id,
      summary: body.current
        ? `Legislatura nº ${legislature.number} marcada como atual (demais desmarcadas).`
        : `Legislatura nº ${legislature.number} atualizada.`,
      before: { number: current.number, startYear: current.startYear, endYear: current.endYear, current: current.current },
      after: { number: legislature.number, startYear: legislature.startYear, endYear: legislature.endYear, current: legislature.current },
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
      internalPayload: {
        entity: 'legislature',
        event: body.current ? 'set_current' : 'updated',
        id: current.id,
        number: legislature.number,
      },
    })
    return legislature
  })

  return Response.json({ legislature: toLegislatureView(updated) })
})
