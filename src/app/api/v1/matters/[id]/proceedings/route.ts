/**
 * GET|POST /api/v1/matters/:id/proceedings — tramitação append-only da matéria.
 * GET: timeline ordenada por seq.
 * POST: RBAC matter.write; registra andamento validando:
 *   - seq = último+1 (concorrência → 409 PROCEEDING_SEQ_CONFLICT);
 *   - fromStatus = situação ATUAL da matéria;
 *   - toStatus conforme MATTER_STATUS_TRANSITIONS (terminais recusam; andamento
 *     informativo mantém a mesma situação);
 *   - atualiza a situação da matéria EXCLUSIVAMENTE por aqui.
 * Auditoria `matter.proceeding` + outbox `matter.proceeding` (público) e
 * `matter.status_changed` (público) quando a situação muda.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { loadMatter } from '@/lib/server/loaders'
import { toProceedingView, toMatterView, matterLabel } from '@/lib/server/serializers'
import {
  assertProceedingTransition,
  PROCEEDING_ACTIONS,
  type MatterStatusValue,
} from '@/lib/server/domain'
import { MATTER_STATUS_LABEL, PROCEEDING_ACTION_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)
  const proceedings = await db.proceeding.findMany({
    where: { matterId: matter.id },
    orderBy: { seq: 'asc' },
  })
  return Response.json({ proceedings: proceedings.map(toProceedingView) })
})

const createSchema = z.object({
  action: z.enum(PROCEEDING_ACTIONS),
  toStatus: z.enum([
    'em_tramitacao',
    'incluida_pauta',
    'aprovado',
    'rejeitado',
    'retirado',
    'arquivado',
  ]),
  notes: z.string().max(2000).optional(),
  documentRef: z.string().max(120).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  seq: z.number().int().min(1).optional(), // opcional; divergência → 409
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())
  const matter = await loadMatter(actor, id)

  const result = await withTransaction(async (tx) => {
    const last = await tx.proceeding.findFirst({
      where: { matterId: matter.id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    const nextSeq = (last?.seq ?? 0) + 1
    if (body.seq !== undefined && body.seq !== nextSeq) {
      throw new DomainError(
        'PROCEEDING_SEQ_CONFLICT',
        409,
        'Sequência em conflito',
        `Sequência enviada (${body.seq}) difere da esperada (${nextSeq}). A tramitação é append-only — recarregue a timeline.`
      )
    }

    const fromStatus = matter.status as MatterStatusValue
    const toStatus = body.toStatus as MatterStatusValue
    assertProceedingTransition(fromStatus, toStatus)

    const created = await tx.proceeding.create({
      data: {
        matterId: matter.id,
        seq: nextSeq,
        action: body.action,
        fromStatus,
        toStatus,
        actorName: actor.name,
        actorRole: actor.role,
        notes: body.notes?.trim() ?? null,
        documentRef: body.documentRef?.trim() ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      },
    })

    const statusChanged = toStatus !== fromStatus
    const updatedMatter = await tx.legislativeMatter.update({
      where: { id: matter.id },
      data: { status: toStatus },
    })

    const label = matterLabel(updatedMatter)
    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.proceeding',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `${label} — ${PROCEEDING_ACTION_LABEL[body.action] ?? body.action} (seq ${nextSeq})${
        statusChanged ? `: ${MATTER_STATUS_LABEL[fromStatus]} → ${MATTER_STATUS_LABEL[toStatus]}` : ''
      }.`,
      before: { status: fromStatus, seq: nextSeq - 1 },
      after: { status: toStatus, seq: nextSeq, action: body.action },
      correlationId,
      ip: clientIp(req),
    })

    const occurredAt = created.createdAt.toISOString()
    await emitOutbox(tx, {
      tenantId: matter.tenantId,
      eventType: 'matter.proceeding',
      aggregateId: matter.id,
      aggregateVersion: nextSeq,
      correlationId,
      origin: 'operator',
      internalPayload: {
        matterId: matter.id,
        matterLabel: label,
        seq: nextSeq,
        action: body.action,
        fromStatus,
        toStatus,
        actorName: actor.name,
        notes: created.notes,
        dueAt: created.dueAt?.toISOString() ?? null,
        occurredAt,
      },
      publicPayload: {
        matterId: matter.id,
        action: body.action,
        toStatus,
        seq: nextSeq,
        occurredAt,
      },
    })
    if (statusChanged) {
      await emitOutbox(tx, {
        tenantId: matter.tenantId,
        eventType: 'matter.status_changed',
        aggregateId: matter.id,
        aggregateVersion: nextSeq,
        correlationId,
        origin: 'operator',
        internalPayload: {
          matterId: matter.id,
          matterLabel: label,
          from: fromStatus,
          to: toStatus,
          seq: nextSeq,
          actorName: actor.name,
          occurredAt,
        },
        publicPayload: { matterId: matter.id, from: fromStatus, to: toStatus, seq: nextSeq, occurredAt },
      })
    }
    return { proceeding: created, matter: updatedMatter }
  })

  return Response.json(
    { proceeding: toProceedingView(result.proceeding), matter: toMatterView(result.matter) },
    { status: 201 }
  )
})
