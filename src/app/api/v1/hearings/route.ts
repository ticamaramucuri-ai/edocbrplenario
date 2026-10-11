/**
 * GET|POST /api/v1/hearings — audiências públicas do tenant (Fase 11).
 * GET: filtro status; lista desc por scheduledAt com contagens agregadas
 * de perguntas { pending, approved, rejected, answered } (agregação em
 * memória a partir de HearingQuestion).
 * POST: RBAC hearing.write; cria com status 'scheduled'; auditoria
 * `hearing.created`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { LegislativeMatter } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { aggregateQuestionCounts, toHearingView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const params = new URL(req.url).searchParams
  const status = params.get('status')?.trim() || null

  const hearings = await db.publicHearing.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { scheduledAt: 'desc' },
    take: 200,
  })

  const questions = hearings.length
    ? await db.hearingQuestion.findMany({
        where: { hearingId: { in: hearings.map((h) => h.id) } },
        select: { hearingId: true, status: true },
      })
    : []

  const countsByHearing = new Map<string, ReturnType<typeof aggregateQuestionCounts>>()
  for (const h of hearings) countsByHearing.set(h.id, aggregateQuestionCounts([]))
  for (const q of questions) {
    const counts = countsByHearing.get(q.hearingId)
    if (counts && q.status in counts) counts[q.status as keyof typeof counts] += 1
  }

  return Response.json({
    hearings: hearings.map((h) => toHearingView(h, countsByHearing.get(h.id)!)),
  })
})

const createSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, 'Título deve ter entre 5 e 200 caracteres.')
    .max(200, 'Título deve ter entre 5 e 200 caracteres.'),
  subject: z
    .string()
    .trim()
    .min(5, 'Assunto deve ter entre 5 e 500 caracteres.')
    .max(500, 'Assunto deve ter entre 5 e 500 caracteres.'),
  matterId: z.string().trim().min(1).optional(),
  scheduledAt: z
    .string()
    .min(1, 'Data/hora obrigatória.')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Data/hora inválida (ISO 8601 esperado).'),
  location: z.string().trim().max(200, 'Local deve ter no máximo 200 caracteres.').optional(),
  questionsOpen: z.boolean().optional(),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'hearing.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const body = createSchema.parse(await req.json())
  const scheduledAt = new Date(body.scheduledAt)

  // Matéria vinculada (opcional) precisa existir no escopo do ator.
  let matter: LegislativeMatter | null = null
  if (body.matterId) {
    matter = await db.legislativeMatter.findUnique({ where: { id: body.matterId } })
    if (!matter) throw notFound('Matéria vinculada não encontrada.')
    assertTenantScope(actor, matter.tenantId)
  }

  const hearing = await withTransaction(async (tx) => {
    const created = await tx.publicHearing.create({
      data: {
        tenantId,
        title: body.title.trim(),
        subject: body.subject.trim(),
        matterId: matter?.id ?? null,
        scheduledAt,
        location: body.location?.trim() || null,
        status: 'scheduled',
        questionsOpen: body.questionsOpen ?? true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'hearing.created',
      aggregateType: 'public_hearing',
      aggregateId: created.id,
      summary: `Audiência pública agendada: ${created.title} (${created.scheduledAt.toLocaleString('pt-BR')}).`,
      after: {
        title: created.title,
        subject: created.subject,
        scheduledAt: created.scheduledAt.toISOString(),
        location: created.location,
        status: 'scheduled',
        questionsOpen: created.questionsOpen,
        matterId: created.matterId,
      },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json({ hearing: toHearingView(hearing, aggregateQuestionCounts([])) }, { status: 201 })
})
