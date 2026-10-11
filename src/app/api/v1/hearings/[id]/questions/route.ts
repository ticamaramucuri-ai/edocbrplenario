/**
 * GET /api/v1/hearings/:id/questions — fila de moderação (Fase 11).
 * TODAS as perguntas (todos os status) da audiência, asc por createdAt,
 * COM authorEmail (uso interno legitimado — nunca exposto publicamente),
 * moderatedBy, answer e answeredAt. assertTenantScope: audiência de outro
 * tenant (fora do escopo resolvido) → 404.
 * Resposta: { hearing: {...resumo com contagens}, questions: [...] }.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { aggregateQuestionCounts, toHearingQuestionView, toHearingView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params

  const hearing = await db.publicHearing.findUnique({
    where: { id },
    include: { questions: true },
  })
  if (!hearing || hearing.tenantId !== tenantId) {
    throw notFound('Audiência não encontrada neste tenant.')
  }

  const questions = [...hearing.questions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  )

  return Response.json({
    hearing: toHearingView(hearing, aggregateQuestionCounts(hearing.questions)),
    questions: questions.map(toHearingQuestionView),
  })
})
