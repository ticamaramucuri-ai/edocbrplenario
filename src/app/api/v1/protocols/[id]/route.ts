/**
 * PATCH /api/v1/protocols/:id — distribuir (vincula matéria), arquivar ou anular.
 * Anulação EXIGE justificativa (auditoria reforçada). RBAC protocol.write.
 * Máquina: recebido→distribuido|arquivado|anulado; distribuido→arquivado|anulado;
 * arquivado→anulado; anulado é terminal.
 */
import type { NextRequest } from 'next/server'
import type { LegislativeMatter } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toProtocolEntryView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const PROTOCOL_TRANSITIONS: Record<string, string[]> = {
  recebido: ['distribuido', 'arquivado', 'anulado'],
  distribuido: ['arquivado', 'anulado'],
  arquivado: ['anulado'],
  anulado: [],
}

const patchSchema = z.object({
  action: z.enum(['distribuir', 'arquivar', 'anular']),
  matterId: z.string().optional(), // opcional ao distribuir
  justification: z.string().min(10, 'Justificativa obrigatória (mín. 10 caracteres).').optional(),
  notes: z.string().max(2000).optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'protocol.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.protocolEntry.findUnique({ where: { id } })
  if (!current) throw notFound('Protocolo não encontrado.')
  assertTenantScope(actor, current.tenantId)

  const target = body.action === 'distribuir' ? 'distribuido' : body.action === 'arquivar' ? 'arquivado' : 'anulado'
  if (!PROTOCOL_TRANSITIONS[current.status]?.includes(target)) {
    throw new DomainError(
      'PROTOCOL_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Protocolo em status "${current.status}" não pode ir para "${target}".`
    )
  }
  if (body.action === 'anular' && !body.justification) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Anulação de protocolo exige justificativa auditada.',
      { errors: { justification: ['Informe a justificativa da anulação.'] } }
    )
  }

  let matter: LegislativeMatter | null = null
  if (body.action === 'distribuir' && body.matterId) {
    matter = await db.legislativeMatter.findUnique({ where: { id: body.matterId } })
    if (!matter) throw notFound('Matéria a vincular não encontrada.')
    assertTenantScope(actor, matter.tenantId)
  }

  const protocol = await withTransaction(async (tx) => {
    const updated = await tx.protocolEntry.update({
      where: { id: current.id },
      data: {
        status: target,
        matterId: matter?.id ?? (body.action === 'distribuir' ? current.matterId : undefined),
        notes: body.notes === undefined ? undefined : body.notes?.trim() ?? null,
      },
    })
    const actionAudit =
      body.action === 'distribuir' ? 'protocol.distributed' : body.action === 'arquivar' ? 'protocol.archived' : 'protocol.annulled'
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: actionAudit,
      aggregateType: 'protocol',
      aggregateId: current.id,
      summary: `Protocolo nº ${current.number}/${current.year} — ${body.action} (${target}).`,
      before: { status: current.status, matterId: current.matterId },
      after: { status: updated.status, matterId: updated.matterId },
      justification: body.action === 'anular' ? body.justification : null,
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
        entity: 'protocol',
        event: body.action,
        id: current.id,
        number: current.number,
        year: current.year,
        status: updated.status,
      },
    })
    return updated
  })

  return Response.json({ protocol: toProtocolEntryView(protocol) })
})
