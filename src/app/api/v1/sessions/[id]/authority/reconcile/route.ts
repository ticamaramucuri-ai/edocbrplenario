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
  let appliedCount = 0

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

      // Aplicação material no estado persistido da sessão (presença, votações e votos)
      if (ev.kind === 'voting.opened' && typeof ev.payload.votingId === 'string') {
        const existingVoting = await tx.voting.findUnique({
          where: { id: ev.payload.votingId },
          select: { id: true },
        })
        if (!existingVoting) {
          await tx.voting.create({
            data: {
              id: ev.payload.votingId,
              sessionId: session.id,
              question: typeof ev.payload.question === 'string' ? ev.payload.question : 'Deliberação Local',
              mode: typeof ev.payload.mode === 'string' ? ev.payload.mode : 'nominal',
              status: 'open',
              openedAt: new Date(ev.occurredAt),
            },
          })
          appliedCount += 1
        }
      } else if (ev.kind === 'voting.closed' && typeof ev.payload.votingId === 'string') {
        const updated = await tx.voting.updateMany({
          where: { id: ev.payload.votingId, sessionId: session.id, status: { not: 'closed' } },
          data: { status: 'closed', closedAt: new Date(ev.occurredAt) },
        })
        if (updated.count > 0) appliedCount += 1
      } else if (ev.kind === 'speech.started' && typeof ev.payload.parliamentarianId === 'string') {
        const parl = await tx.parliamentarian.findFirst({
          where: { id: ev.payload.parliamentarianId, tenantId: session.tenantId },
          select: { id: true },
        })
        if (parl) {
          await tx.speech.upsert({
            where: { id: ev.commandId },
            create: {
              id: ev.commandId,
              sessionId: session.id,
              parliamentarianId: parl.id,
              status: 'falando',
              plannedSeconds: typeof ev.payload.durationSeconds === 'number' ? ev.payload.durationSeconds : 300,
              startedAt: new Date(ev.occurredAt),
            },
            update: {},
          })
          appliedCount += 1
        }
      } else if (ev.kind === 'speech.stopped') {
        const stopped = await tx.speech.updateMany({
          where: { sessionId: session.id, status: 'falando' },
          data: { status: 'encerrado', finishedAt: new Date(ev.occurredAt) },
        })
        if (stopped.count > 0) appliedCount += 1
      } else if ((ev.kind === 'attendance.check_in' || ev.kind === 'attendance.check_out') && typeof ev.payload.parliamentarianId === 'string') {
        const parl = await tx.parliamentarian.findFirst({
          where: { id: ev.payload.parliamentarianId, tenantId: session.tenantId },
          select: { id: true },
        })
        if (parl) {
          const priorAtt = await tx.attendanceEvent.findUnique({
            where: { sessionId_commandId: { sessionId: session.id, commandId: ev.commandId } },
            select: { id: true },
          })
          if (!priorAtt) {
            await tx.attendanceEvent.create({
              data: {
                sessionId: session.id,
                parliamentarianId: parl.id,
                kind: ev.kind === 'attendance.check_in' ? 'check_in' : 'check_out',
                status: ev.kind === 'attendance.check_in' ? 'presente' : 'saida_temporaria',
                source: 'local_server',
                actorId: actor.id,
                commandId: ev.commandId,
                createdAt: new Date(ev.occurredAt),
              },
            })
            appliedCount += 1
          }
        }
      } else if (
        ev.kind === 'vote.cast' &&
        typeof ev.payload.votingId === 'string' &&
        typeof ev.payload.parliamentarianId === 'string' &&
        typeof ev.payload.value === 'string'
      ) {
        const [voting, parl] = await Promise.all([
          tx.voting.findFirst({ where: { id: ev.payload.votingId, sessionId: session.id }, select: { id: true } }),
          tx.parliamentarian.findFirst({ where: { id: ev.payload.parliamentarianId, tenantId: session.tenantId }, select: { id: true } }),
        ])
        if (voting && parl) {
          const priorVote = await tx.vote.findUnique({
            where: { votingId_commandId: { votingId: voting.id, commandId: ev.commandId } },
            select: { id: true },
          })
          if (!priorVote) {
            await tx.vote.upsert({
              where: { votingId_parliamentarianId: { votingId: voting.id, parliamentarianId: parl.id } },
              create: {
                votingId: voting.id,
                parliamentarianId: parl.id,
                value: ev.payload.value,
                commandId: ev.commandId,
                receivedAt: new Date(ev.occurredAt),
              },
              update: {
                value: ev.payload.value,
                commandId: ev.commandId,
                changedAt: new Date(ev.occurredAt),
              },
            })
            appliedCount += 1
          }
        }
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
    appliedCount,
    deduplicatedCount,
    quarantined,
  })
})

