/**
 * PATCH /api/v1/hearing-questions/:id — moderação de perguntas (Fase 11).
 *
 * RBAC hearing.write. Ações (body `action`):
 * - 'approve': pending→approved (moderatedBy=ator); auditoria
 *   `hearing.question_moderated`; outbox público `hearing.question_approved`
 *   { hearingId, questionId } — SEM dados do autor;
 * - 'reject': pending→rejected (moderatedBy); auditoria `hearing.question_moderated`;
 * - 'answer': approved→answered com resposta (5..2000, answeredAt=now);
 *   auditoria `hearing.question_answered`.
 * Transição inválida → 409 HEARING_INVALID_TRANSITION. Escopo: pergunta
 * buscada com a audiência incluída; assertTenantScope no hearing (403 para
 * outro tenant) + 404 quando fora do escopo resolvido (plataforma).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import {
  assertQuestionTransition,
  toHearingQuestionView,
} from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject') }),
  z.object({
    action: z.literal('answer'),
    answer: z
      .string()
      .trim()
      .min(5, 'Resposta deve ter entre 5 e 2000 caracteres.')
      .max(2000, 'Resposta deve ter entre 5 e 2000 caracteres.'),
  }),
])

export const PATCH = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'hearing.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())
  const ip = clientIp(req)

  // Pergunta SEMPRE com a audiência (dono do tenant) incluída.
  const current = await db.hearingQuestion.findUnique({
    where: { id },
    include: { hearing: true },
  })
  if (!current) throw notFound('Pergunta não encontrada.')
  assertTenantScope(actor, current.hearing.tenantId)
  if (current.hearing.tenantId !== tenantId) {
    throw notFound('Pergunta não encontrada neste tenant.')
  }

  const target =
    body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : 'answered'
  assertQuestionTransition(current.status, target)

  const question = await withTransaction(async (tx) => {
    const updated = await tx.hearingQuestion.update({
      where: { id: current.id },
      data: {
        status: target,
        ...(body.action === 'answer' ? { answer: body.answer, answeredAt: new Date() } : {}),
        // aprovar/rejeitar registra o moderador; responder mantém o original.
        ...(body.action !== 'answer' ? { moderatedBy: actor.name } : {}),
      },
      include: { hearing: true },
    })

    const truncate = (s: string, max = 100) =>
      s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s

    await writeAudit(tx, {
      tenantId: current.hearing.tenantId,
      actor,
      action:
        body.action === 'answer' ? 'hearing.question_answered' : 'hearing.question_moderated',
      aggregateType: 'hearing_question',
      aggregateId: current.id,
      summary:
        body.action === 'approve'
          ? `Pergunta de ${current.authorName} APROVADA na audiência "${current.hearing.title}": ${truncate(current.question)}.`
          : body.action === 'reject'
            ? `Pergunta de ${current.authorName} REJEITADA na audiência "${current.hearing.title}": ${truncate(current.question)}.`
            : `Pergunta de ${current.authorName} RESPONDIDA na audiência "${current.hearing.title}".`,
      before: { status: current.status, answer: current.answer },
      after: {
        status: updated.status,
        answer: updated.answer,
        moderatedBy: updated.moderatedBy,
      },
      correlationId,
      ip,
    })

    if (body.action === 'approve') {
      // Evento público SEM quaisquer dados do autor (LGPD).
      await emitOutbox(tx, {
        tenantId: current.hearing.tenantId,
        eventType: 'hearing.question_approved',
        aggregateId: current.id,
        aggregateVersion: 1,
        correlationId,
        origin: 'operator',
        internalPayload: {
          hearingId: current.hearingId,
          questionId: current.id,
          status: 'approved',
          moderatedBy: actor.name,
        },
        publicPayload: {
          hearingId: current.hearingId,
          questionId: current.id,
        },
      })
    }

    return updated
  })

  return Response.json({ question: toHearingQuestionView(question) })
})
