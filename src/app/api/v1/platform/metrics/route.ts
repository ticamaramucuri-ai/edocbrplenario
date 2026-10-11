/**
 * GET /api/v1/platform/metrics — métricas SaaS de negócio (Fase 24, ADR-025).
 * RBAC platform.read (owner + support).
 *
 *  - activeTenants: tenants com active=true;
 *  - mrrCents: soma do priceCents do plano de cada assinatura com status
 *    'active' — CONVENÇÃO SaaS: TRIAIS NÃO CONTAM no MRR (só entram quando
 *    convertemos para cobrança; past_due também fica fora por representar
 *    receita não realizada no mês);
 *  - churn90d: % de tenants desativados (active=false) cujo updatedAt cai nos
 *    últimos 90 dias sobre o total de tenants (0 quando não há churn);
 *  - trials: tenants com trialEndsAt futuro OU assinatura em status 'trial'
 *    (união sem dupla contagem);
 *  - npsAverage/npsResponses: média das NpsResponse da versão atual
 *    (CURRENT_VERSION — alinhada ao help-content.ts; o main atualiza na
 *    consolidação da Onda 5).
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import type { PlatformMetricsView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

/** Versão do produto avaliada pelo NPS — espelha src/lib/server/help-content.ts. */
const CURRENT_VERSION = '0.13.0'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  const now = new Date()

  const [activeTenants, activeSubscriptions, totalTenants, churnedTenants, trialByDate, trialBySubscription, npsRows] =
    await Promise.all([
      db.tenant.count({ where: { active: true } }),
      // MRR: apenas assinaturas 'active' (trials não contam — documentado).
      db.subscription.findMany({
        where: { status: 'active' },
        select: { plan: { select: { priceCents: true } } },
      }),
      db.tenant.count(),
      db.tenant.count({
        where: { active: false, updatedAt: { gte: new Date(now.getTime() - NINETY_DAYS_MS) } },
      }),
      db.tenant.findMany({ where: { trialEndsAt: { gt: now } }, select: { id: true } }),
      db.tenant.findMany({
        where: { subscription: { status: 'trial' } },
        select: { id: true },
      }),
      db.npsResponse.findMany({
        where: { version: CURRENT_VERSION },
        select: { score: true },
      }),
    ])

  const mrrCents = activeSubscriptions.reduce((acc, s) => acc + s.plan.priceCents, 0)

  // Trials: união de tenants com trial vigente OU assinatura trial (sem dupla contagem).
  const trialTenantIds = new Set<string>()
  for (const t of trialByDate) trialTenantIds.add(t.id)
  for (const t of trialBySubscription) trialTenantIds.add(t.id)

  const churn90d =
    totalTenants > 0 ? Math.round((churnedTenants / totalTenants) * 1000) / 10 : 0

  const npsResponses = npsRows.length
  const npsAverage =
    npsResponses > 0
      ? Math.round((npsRows.reduce((acc, r) => acc + r.score, 0) / npsResponses) * 100) / 100
      : null

  const view: PlatformMetricsView = {
    activeTenants,
    mrrCents,
    churn90d,
    trials: trialTenantIds.size,
    npsAverage,
    npsResponses,
  }
  return Response.json(view)
})
