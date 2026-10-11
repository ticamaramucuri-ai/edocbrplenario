/**
 * GET /api/v1/public/hearings — audiências públicas do portal (Fase 11).
 * Sem autenticação; `?tenant=slug` (default: 1º tenant ativo).
 * Não-canceladas, desc por scheduledAt, com `answeredCount` (perguntas
 * respondidas). View pública SEM contagens internas de moderação.
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toPublicHearingView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))

  const hearings = await db.publicHearing.findMany({
    where: { tenantId: tenant.id, status: { not: 'canceled' } },
    orderBy: { scheduledAt: 'desc' },
    take: 100,
  })

  const questions = hearings.length
    ? await db.hearingQuestion.findMany({
        where: { hearingId: { in: hearings.map((h) => h.id) }, status: 'answered' },
        select: { hearingId: true },
      })
    : []

  const answeredByHearing = new Map<string, number>()
  for (const h of hearings) answeredByHearing.set(h.id, 0)
  for (const q of questions) {
    answeredByHearing.set(q.hearingId, (answeredByHearing.get(q.hearingId) ?? 0) + 1)
  }

  return Response.json({
    hearings: hearings.map((h) => toPublicHearingView(h, answeredByHearing.get(h.id) ?? 0)),
  })
})
