/**
 * GET /api/v1/public/matters/:id — detalhe público da matéria: dados +
 * tramitação pública (seq, action, toStatus, createdAt) + última votação com
 * resultado (nominalDetail apenas se modo != secreto) + versões (apenas
 * versão/autor/data — nunca o texto integral) + desfecho mais recente
 * (sanção/veto com prazo de apreciação — transparência do ciclo final,
 * Fase 17). ?tenant=slug (default 1º).
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toPublicMatterDetail } from '@/lib/server/public-serializers'
import { toMatterOutcomeView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const { id } = await ctx.params
  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))

  const matter = await db.legislativeMatter.findUnique({ where: { id } })
  if (!matter || matter.tenantId !== tenant.id) {
    throw notFound('Matéria não encontrada neste tenant.')
  }

  const [proceedings, votings, versions, parliamentarians, outcomes] = await Promise.all([
    db.proceeding.findMany({ where: { matterId: matter.id }, orderBy: { seq: 'asc' } }),
    db.voting.findMany({
      where: { matterId: matter.id, status: 'closed', resultStatus: { not: null } },
      orderBy: { closedAt: 'desc' },
    }),
    db.matterVersion.findMany({
      where: { matterId: matter.id },
      select: { version: true, authorName: true, createdAt: true },
    }),
    db.parliamentarian.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, party: true },
    }),
    db.matterOutcome.findMany({
      where: { matterId: matter.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 1,
    }),
  ])

  const partyById = new Map(parliamentarians.map((p) => [p.id, p.party]))
  const lastVoting = votings[0] ?? null
  const lastOutcome = outcomes[0] ?? null

  return Response.json({
    ...toPublicMatterDetail(matter, proceedings, lastVoting, versions, partyById),
    outcome: lastOutcome ? toMatterOutcomeView(lastOutcome) : null,
  })
})
