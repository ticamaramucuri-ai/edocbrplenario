/**
 * PATCH|GET /api/v1/hearings/:id — audiências públicas (Fase 11).
 *
 * PATCH (RBAC hearing.write) discrimina por `action`:
 * - 'open': scheduled→open;
 * - 'close': open→closed (E encerra o recebimento de perguntas);
 * - 'cancel': scheduled|open→canceled com justificativa (min 10) — terminal;
 * - 'toggle_questions': liga/desliga o recebimento de perguntas do cidadão
 *   (apenas em audiências não terminais — usado pelo Switch do módulo).
 * Máquina inválida → 409 HEARING_INVALID_TRANSITION. Auditoria
 * `hearing.state_changed` (before/after; justification ao cancelar) e
 * outbox público `hearing.state_changed` { hearingId, title, status }.
 * Audiência de outro tenant (fora do escopo resolvido) → 404.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { assertHearingTransition, toHearingView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params

  const hearing = await db.publicHearing.findUnique({
    where: { id },
    include: { questions: { select: { status: true } } },
  })
  if (!hearing || hearing.tenantId !== tenantId) {
    throw notFound('Audiência não encontrada neste tenant.')
  }
  const counts = { pending: 0, approved: 0, rejected: 0, answered: 0 }
  for (const q of hearing.questions) {
    if (q.status in counts) counts[q.status as keyof typeof counts] += 1
  }
  return Response.json({ hearing: toHearingView(hearing, counts) })
})

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open') }),
  z.object({ action: z.literal('close') }),
  z.object({
    action: z.literal('cancel'),
    justification: z
      .string()
      .trim()
      .min(10, 'Justificativa obrigatória (mín. 10 caracteres).')
      .max(2000),
  }),
  z.object({
    action: z.literal('toggle_questions'),
    questionsOpen: z.boolean(),
  }),
])

export const PATCH = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'hearing.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())
  const ip = clientIp(req)

  const current = await db.publicHearing.findUnique({
    where: { id },
    include: { questions: { select: { status: true } } },
  })
  if (!current || current.tenantId !== tenantId) {
    throw notFound('Audiência não encontrada neste tenant.')
  }

  const countQuestions = (h: typeof current) => {
    const counts = { pending: 0, approved: 0, rejected: 0, answered: 0 }
    for (const q of h.questions) {
      if (q.status in counts) counts[q.status as keyof typeof counts] += 1
    }
    return counts
  }

  const hearing = await withTransaction(async (tx: Prisma.TransactionClient) => {
    if (body.action === 'toggle_questions') {
      // Apenas audiências não terminais podem alternar o recebimento.
      if (current.status === 'closed' || current.status === 'canceled') {
        throw new DomainError(
          'HEARING_INVALID_TRANSITION',
          409,
          'Transição inválida',
          'Audiência encerrada ou cancelada não pode alterar o recebimento de perguntas.'
        )
      }
      const updated = await tx.publicHearing.update({
        where: { id: current.id },
        data: { questionsOpen: body.questionsOpen },
        include: { questions: { select: { status: true } } },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'hearing.state_changed',
        aggregateType: 'public_hearing',
        aggregateId: current.id,
        summary: `Recebimento de perguntas ${body.questionsOpen ? 'reaberto' : 'encerrado'} na audiência: ${current.title}.`,
        before: { status: current.status, questionsOpen: current.questionsOpen },
        after: { status: updated.status, questionsOpen: updated.questionsOpen },
        correlationId,
        ip,
      })
      return updated
    }

    const target = body.action === 'open' ? 'open' : body.action === 'close' ? 'closed' : 'canceled'
    assertHearingTransition(current.status, target)

    const updated = await tx.publicHearing.update({
      where: { id: current.id },
      data: {
        status: target,
        // Encerrar a audiência também encerra o recebimento de perguntas.
        ...(body.action === 'close' ? { questionsOpen: false } : {}),
      },
      include: { questions: { select: { status: true } } },
    })

    const summaryByAction: Record<string, string> = {
      open: `Audiência pública ABERTA: ${current.title}.`,
      close: `Audiência pública ENCERRADA: ${current.title}.`,
      cancel: `Audiência pública CANCELADA: ${current.title}.`,
    }
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'hearing.state_changed',
      aggregateType: 'public_hearing',
      aggregateId: current.id,
      summary: summaryByAction[body.action],
      before: { status: current.status, questionsOpen: current.questionsOpen },
      after: { status: updated.status, questionsOpen: updated.questionsOpen },
      justification: body.action === 'cancel' ? body.justification : null,
      correlationId,
      ip,
    })

    const priorEvents = await tx.outboxEvent.count({ where: { tenantId, aggregateId: current.id } })
    await emitOutbox(tx, {
      tenantId,
      eventType: 'hearing.state_changed',
      aggregateId: current.id,
      aggregateVersion: priorEvents + 1,
      correlationId,
      origin: 'operator',
      internalPayload: {
        hearingId: current.id,
        title: current.title,
        before: current.status,
        status: updated.status,
        questionsOpen: updated.questionsOpen,
      },
      publicPayload: {
        hearingId: current.id,
        title: current.title,
        status: updated.status,
      },
    })

    return updated
  })

  return Response.json({ hearing: toHearingView(hearing, countQuestions(hearing)) })
})
