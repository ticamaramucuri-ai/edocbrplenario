/**
 * GET|POST /api/v1/matters/:id/outcomes — desfechos da matéria (Fase 17 /
 * ADR-018): sanção e vetos do ciclo pós-aprovação.
 *
 * RBAC:
 * - GET: qualquer ator autenticado com escopo no tenant da matéria.
 * - POST: requirePermission 'matter.write' (tenant_admin, legislative_admin).
 *
 * Regras de negócio (POST):
 * - sancao: permitida com status 'aprovado' OU com status 'vetado' quando o
 *   último desfecho é 'veto_parcial' (promulgação da parte não vetada);
 *   transiciona a matéria para 'sancionado'.
 * - veto_total/veto_parcial: apenas com status 'aprovado'; a justificativa
 *   (notes) é OBRIGATÓRIA; transiciona para 'vetado'.
 * - Desfecho do MESMO kind do último registrado → 422 (duplicado).
 * - Veto agenda LegislativeTask "Apreciar veto …" (prazo = dueAt informado ou
 *   +15 dias às 19h) e registra Proceeding ('sanco'/'veto') com o próximo seq
 *   da tramitação; a transição de status ocorre EXCLUSIVAMENTE aqui dentro da
 *   mesma transação (nunca por edição direta).
 * - Auditoria 'matter.outcome' (before/after com status e kind) na transação.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { loadMatter } from '@/lib/server/loaders'
import { toMatterView, toMatterOutcomeView, matterLabel } from '@/lib/server/serializers'
import { MATTER_OUTCOME_KIND_LABEL, MATTER_STATUS_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)

  const outcomes = await db.matterOutcome.findMany({
    where: { matterId: matter.id },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })

  return Response.json({ outcomes: outcomes.map(toMatterOutcomeView) })
})

const createSchema = z.object({
  kind: z.enum(['sancao', 'veto_total', 'veto_parcial']),
  actorName: z
    .string()
    .trim()
    .min(2, 'Informe o autor do desfecho (ex.: Prefeito Municipal).')
    .max(120),
  notes: z.string().max(2000, 'A justificativa deve ter no máximo 2000 caracteres.').optional(),
  dueAt: z
    .union([
      z.string().datetime({ offset: true }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.'),
    ])
    .optional(),
})

/** Prazo regimental padrão de apreciação: +15 dias às 19h (padrão do seed). */
function defaultVetoDueAt(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 15)
  d.setHours(19, 0, 0, 0)
  return d
}

export const POST = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())
  const matter = await loadMatter(actor, id)

  const lastOutcome = await db.matterOutcome.findFirst({
    where: { matterId: matter.id },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  // Regra: desfecho duplicado (mesmo kind do último registrado).
  if (lastOutcome && lastOutcome.kind === body.kind) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Desfecho duplicado',
      `O último desfecho de ${matterLabel(matter)} já é "${MATTER_OUTCOME_KIND_LABEL[body.kind]}".`,
      { errors: { kind: ['Desfecho duplicado — o último registro já é deste tipo.'] } }
    )
  }

  // Regras de pré-condição por kind conforme a situação da matéria.
  const status = matter.status
  if (body.kind === 'sancao') {
    const promotableAfterPartialVeto = status === 'vetado' && lastOutcome?.kind === 'veto_parcial'
    if (status !== 'aprovado' && !promotableAfterPartialVeto) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Sanção não permitida',
        `Sanção exige matéria aprovada (ou promulgação da parte não vetada após veto parcial). Situação atual: ${
          MATTER_STATUS_LABEL[status as keyof typeof MATTER_STATUS_LABEL] ?? status
        }.`,
        { errors: { kind: ['Sanção só é permitida sobre matéria aprovada (ou após veto parcial).'] } }
      )
    }
  } else {
    // veto_total / veto_parcial: apenas sobre matéria aprovada + justificativa obrigatória.
    if (status !== 'aprovado') {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Veto não permitido',
        `Veto exige matéria aprovada. Situação atual: ${
          MATTER_STATUS_LABEL[status as keyof typeof MATTER_STATUS_LABEL] ?? status
        }.`,
        { errors: { kind: ['Veto só pode ser registrado sobre matéria aprovada.'] } }
      )
    }
    if (!body.notes || !body.notes.trim()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Justificativa obrigatória',
        'A justificativa (notes) é obrigatória para registrar um veto.',
        { errors: { notes: ['A justificativa do veto é obrigatória.'] } }
      )
    }
  }

  const toStatus = body.kind === 'sancao' ? 'sancionado' : 'vetado'
  const isVeto = body.kind !== 'sancao'
  const parsedDueAt = body.dueAt ? new Date(body.dueAt) : null
  if (body.dueAt && Number.isNaN(parsedDueAt?.getTime())) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Prazo de apreciação (dueAt) inválido.',
      { errors: { dueAt: ['Data de prazo inválida.'] } }
    )
  }
  const dueAt = parsedDueAt ?? (isVeto ? defaultVetoDueAt() : null)

  const result = await withTransaction(async (tx) => {
    const lastProceeding = await tx.proceeding.findFirst({
      where: { matterId: matter.id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    const nextSeq = (lastProceeding?.seq ?? 0) + 1

    const outcome = await tx.matterOutcome.create({
      data: {
        matterId: matter.id,
        kind: body.kind,
        actorName: body.actorName,
        date: new Date(),
        notes: body.notes?.trim() || null,
        dueAt,
      },
    })

    // Andamento da tramitação (append-only) com o próximo seq — action
    // 'sanco'/'veto' já previstas no enum de ações do modelo.
    await tx.proceeding.create({
      data: {
        matterId: matter.id,
        seq: nextSeq,
        action: body.kind === 'sancao' ? 'sanco' : 'veto',
        fromStatus: matter.status,
        toStatus,
        actorName: actor.name,
        actorRole: actor.role,
        notes: body.notes?.trim() || null,
        dueAt,
      },
    })

    // Veto agenda a apreciação pelo Plenário (tarefa com prazo regimental).
    if (isVeto) {
      await tx.legislativeTask.create({
        data: {
          tenantId: matter.tenantId,
          matterId: matter.id,
          title: `Apreciar veto ${body.kind === 'veto_total' ? 'total' : 'parcial'} — ${matterLabel(matter)}`,
          kind: 'prazo',
          dueAt: dueAt as Date,
          status: 'pendente',
          assigneeName: 'Plenário',
        },
      })
    }

    const updatedMatter = await tx.legislativeMatter.update({
      where: { id: matter.id },
      data: { status: toStatus },
    })

    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.outcome',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `${matterLabel(matter)} — ${MATTER_OUTCOME_KIND_LABEL[body.kind]} registrado por ${
        body.actorName
      }: ${MATTER_STATUS_LABEL[matter.status as keyof typeof MATTER_STATUS_LABEL] ?? matter.status} → ${
        MATTER_STATUS_LABEL[toStatus as keyof typeof MATTER_STATUS_LABEL] ?? toStatus
      }.`,
      before: { status: matter.status, lastOutcomeKind: lastOutcome?.kind ?? null },
      after: { status: toStatus, kind: body.kind, dueAt: dueAt?.toISOString() ?? null },
      correlationId,
      ip: clientIp(req),
    })

    return { outcome, matter: updatedMatter }
  })

  return Response.json(
    { outcome: toMatterOutcomeView(result.outcome), matter: toMatterView(result.matter) },
    { status: 201 }
  )
})
