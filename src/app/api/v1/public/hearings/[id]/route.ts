/**
 * GET /api/v1/public/hearings/:id — detalhe público da audiência (Fase 11).
 * Sem autenticação; `?tenant=slug` (default: 1º tenant ativo).
 * Inclui `questions` com status approved|answered (answered traz answer +
 * answeredAt). authorName e district SIM; authorEmail NUNCA (LGPD).
 * Audiência cancelada ou de outro tenant → 404.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toPublicHearingQuestionView, toPublicHearingView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const { id } = await ctx.params
  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))

  const hearing = await db.publicHearing.findUnique({
    where: { id },
    include: { questions: true },
  })
  if (!hearing || hearing.tenantId !== tenant.id || hearing.status === 'canceled') {
    throw notFound('Audiência não encontrada neste tenant.')
  }

  // Apenas perguntas aprovadas (ou já respondidas) — ordem de chegada.
  const questions = hearing.questions
    .filter((q) => q.status === 'approved' || q.status === 'answered')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toPublicHearingQuestionView)

  const answeredCount = questions.filter((q) => q.status === 'answered').length

  return Response.json({
    hearing: { ...toPublicHearingView(hearing, answeredCount), questions },
  })
})
