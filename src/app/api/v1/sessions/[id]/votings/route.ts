/**
 * GET|POST /api/v1/sessions/:id/votings
 * POST cria votação `ready` (RBAC voting.write), vinculada ao item da pauta
 * opcional (herda matéria e questão = título do item; item → em_votacao).
 * Fase 18: `options?: [{key,label}]` (1–5) cria VotingOptions que SUBSTITUEM
 * sim/nao/abstencao para efeitos de voto e contagem.
 * Emite `voting.created` + `agenda.updated`; auditoria `voting.created`.
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
import { emitOutbox } from '@/lib/server/outbox'
import { tenantSettings } from '@/lib/server/domain'
import { toVotingView } from '@/lib/server/serializers'
import { SESSION_STATUS_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const votings = await db.voting.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    include: {
      votes: { include: { parliamentarian: true } },
      options: { orderBy: { order: 'asc' } },
    },
  })
  return Response.json({
    votings: votings.map((v) =>
      toVotingView(
        v,
        [...v.votes].sort((a, b) => a.parliamentarian.order - b.parliamentarian.order)
      )
    ),
  })
})

const optionSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9_]{2,40}$/, 'Chave deve ter 2–40 caracteres (a-z, 0-9 e _).'),
  label: z.string().trim().min(1, 'Rótulo não pode ser vazio.').max(60, 'Rótulo deve ter até 60 caracteres.'),
})

const bodySchema = z
  .object({
    agendaItemId: z.string().min(1).optional(),
    question: z.string().min(3).max(500).optional(),
    mode: z.enum(['nominal', 'simbolico', 'secreto']),
    rule: z.enum(['maioria_simples', 'maioria_absoluta', 'unanimidade']).optional(),
    hidePartial: z.boolean().optional(),
    /** Fase 18: opções customizadas — ausente/vazio mantém sim/nao/abstencao. */
    options: z.array(optionSchema).max(5, 'Informe no máximo 5 opções.').optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.agendaItemId && !body.question) {
      ctx.addIssue({
        code: 'custom',
        path: ['question'],
        message: 'Informe a questão ou vincule um item da pauta.',
      })
    }
    if (body.options && body.options.length > 0) {
      const keys = body.options.map((o) => o.key)
      const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))]
      if (dup.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `Chaves de opção duplicadas: ${dup.join(', ')}.`,
        })
      }
    }
  })

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'voting.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, id)
  if (!['open', 'suspended', 'resumed'].includes(session.status)) {
    throw new DomainError(
      'SESSION_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Votações só podem ser criadas com a sessão aberta/suspensa/retomada — status atual: ${SESSION_STATUS_LABEL[session.status as keyof typeof SESSION_STATUS_LABEL] ?? session.status}.`
    )
  }

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId } })
  if (!tenant) throw new DomainError('NOT_FOUND', 404, 'Não encontrado', 'Tenant não encontrado.')
  const activeMembers = await db.parliamentarian.count({ where: { tenantId: session.tenantId, active: true } })
  const settings = tenantSettings(tenant, activeMembers)

  let agendaItem: Awaited<ReturnType<typeof db.agendaItem.findUnique>> = null
  if (body.agendaItemId) {
    agendaItem = await db.agendaItem.findUnique({ where: { id: body.agendaItemId } })
    if (!agendaItem || agendaItem.sessionId !== session.id) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Item de pauta não encontrado nesta sessão.',
        { errors: { agendaItemId: ['Item de pauta não pertence à sessão informada.'] } }
      )
    }
  }

  const matter = agendaItem?.matterId ? await db.legislativeMatter.findFirst({
    where: { id: agendaItem.matterId, tenantId: session.tenantId }, select: { type: true },
  }) : null
  const policy = matter ? settings.votingPoliciesByMatterType[matter.type as keyof typeof settings.votingPoliciesByMatterType] : undefined
  if (policy && body.rule && body.rule !== policy.rule) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Regra regimental',
      'A regra de aprovação desta matéria foi configurada pela Câmara e não pode ser alterada nesta votação.')
  }
  const rule = policy?.rule ?? body.rule ?? 'maioria_simples'
  const requiredQuorum = policy?.quorumMinimum ?? settings.quorumMinimum

  const voting = await withTransaction(async (tx) => {
    const created = await tx.voting.create({
      data: {
        sessionId: session.id,
        agendaItemId: agendaItem?.id ?? null,
        matterId: agendaItem?.matterId ?? null,
        question: body.question ?? agendaItem!.title,
        mode: body.mode,
        status: 'ready',
        rule,
        requiredQuorum,
        hidePartial: body.hidePartial ?? settings.hidePartialByDefault,
        version: 1,
      },
    })
    // Fase 18: opções customizadas substituem sim/nao/abstencao (voto + contagem)
    const customOptions = body.options ?? []
    if (customOptions.length > 0) {
      await tx.votingOption.createMany({
        data: customOptions.map((o, i) => ({
          votingId: created.id,
          key: o.key,
          label: o.label,
          order: i,
        })),
      })
    }
    if (agendaItem) {
      await tx.agendaItem.update({
        where: { id: agendaItem.id },
        data: { status: 'em_votacao' },
      })
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'voting.created',
      aggregateType: 'voting',
      aggregateId: created.id,
      summary: `Votação criada (${body.mode}): ${created.question.slice(0, 80)}${
        customOptions.length > 0
          ? ` — opções customizadas: ${customOptions.map((o) => o.key).join(', ')}`
          : ''
      }`,
      after: {
        status: 'ready',
        mode: created.mode,
        rule: created.rule,
        requiredQuorum: created.requiredQuorum,
        options: customOptions.map((o) => o.key),
      },
      correlationId,
      ip: clientIp(req),
    })

    const createdPayload = {
      votingId: created.id,
      sessionId: session.id,
      question: created.question,
      mode: created.mode,
      status: created.status,
      // Opções são públicas (telão/portal exibem os rótulos na votação em curso)
      options: customOptions.map((o) => ({ key: o.key, label: o.label })),
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'voting.created',
      aggregateId: created.id,
      sessionId: session.id,
      aggregateVersion: created.version,
      correlationId,
      internalPayload: createdPayload,
      publicPayload: createdPayload,
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'agenda.updated',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
      internalPayload: { sessionId: session.id },
      publicPayload: { sessionId: session.id },
    })

    return tx.voting.findUnique({
      where: { id: created.id },
      include: {
        votes: { include: { parliamentarian: true } },
        options: { orderBy: { order: 'asc' } },
      },
    })
  })

  return Response.json({ voting: toVotingView(voting!, voting!.votes) }, { status: 201 })
})
