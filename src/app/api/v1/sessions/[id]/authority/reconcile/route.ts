/**
 * POST /api/v1/sessions/:id/authority/reconcile — recebe lote ordenado de eventos
 * do diário local do desktop, deduplica por commandId e emite ACK durável.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const eventSchema = z.object({
  seq: z.number().int().min(1),
  commandId: z.string().uuid('commandId deve ser UUID válido.'),
  kind: z.string().trim().min(2).max(80),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
  entrySha256: z.string().regex(/^[0-9a-f]{64}$/),
})

const bodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  epoch: z.number().int().min(1),
  events: z.array(eventSchema).min(1).max(200),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())
  const session = await loadSession(actor, id)
  const ip = clientIp(req)

  const lease = await db.localSessionAuthorityLease.findUnique({
    where: { sessionId: session.id },
    select: { tenantId: true, deviceId: true, epoch: true },
  })
  if (!lease || lease.tenantId !== session.tenantId) {
    throw new DomainError('LOCAL_AUTHORITY_PRECONDITION', 409, 'Sem concessão registrada', 'Não há concessão de autoridade local para reconciliar nesta sessão.')
  }
  if (lease.deviceId !== body.deviceId || body.epoch > lease.epoch) {
    throw new DomainError('LOCAL_AUTHORITY_CONFLICT', 409, 'Dispositivo ou época divergente', 'O dispositivo ou época informados não correspondem à concessão emitida pelo SaaS.')
  }

  const ordered = [...body.events].sort((a, b) => a.seq - b.seq)
  const ackedSeqs: number[] = []
  const quarantined: Array<{ seq: number; commandId: string; reason: string }> = []
  let deduplicatedCount = 0

  await withTransaction(async (tx) => {
    for (const ev of ordered) {
      if (body.epoch < lease.epoch) {
        quarantined.push({ seq: ev.seq, commandId: ev.commandId, reason: `Época ${body.epoch} superada pela época ${lease.epoch}.` })
        continue
      }

      const existing = await tx.auditEvent.findFirst({
        where: {
          tenantId: session.tenantId,
          aggregateId: session.id,
          action: 'authority.reconciled_event',
          correlationId: ev.commandId,
        },
        select: { id: true },
      })

      if (existing) {
        deduplicatedCount += 1
        ackedSeqs.push(ev.seq)
        continue
      }

      await writeAudit(tx, {
        tenantId: session.tenantId,
        actor,
        action: 'authority.reconciled_event',
        aggregateType: 'session',
        aggregateId: session.id,
        summary: `Evento local reconciliado (seq ${ev.seq}, época ${body.epoch}, ${ev.kind}).`,
        after: {
          seq: ev.seq,
          epoch: body.epoch,
          deviceId: body.deviceId,
          kind: ev.kind,
          entrySha256: ev.entrySha256,
          occurredAt: ev.occurredAt,
          payload: ev.payload,
        },
        correlationId: ev.commandId,
        ip,
      })
      ackedSeqs.push(ev.seq)
    }

    if (quarantined.length > 0) {
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actor,
        action: 'authority.reconcile_quarantined',
        aggregateType: 'session',
        aggregateId: session.id,
        summary: `${quarantined.length} evento(s) local(is) colocado(s) em quarentena por época superada.`,
        after: { epoch: body.epoch, currentEpoch: lease.epoch, quarantined },
        correlationId,
        ip,
      })
    }
  })

  return Response.json({
    reconciled: true,
    sessionId: session.id,
    epoch: body.epoch,
    ackedSeqs,
    deduplicatedCount,
    quarantined,
  })
})
