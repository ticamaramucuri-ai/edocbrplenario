/**
 * GET /api/v1/platform/overview — KPIs globais AGREGADOS da plataforma.
 * RBAC: platform.manage (somente platform_owner). NUNCA expõe conteúdo
 * legislativo de tenants — apenas contagens agregadas (critério de isolamento
 * da Fase 8 do ROADMAP).
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [tenantsTotal, tenantsActive, sessionsThisMonth, votesTotal, outboxPublished, webhooksDead, plans] =
    await Promise.all([
      db.tenant.count(),
      db.tenant.count({ where: { active: true } }),
      db.session.count({ where: { scheduledAt: { gte: monthStart, lt: monthEnd } } }),
      db.vote.count(),
      db.outboxEvent.count({ where: { status: 'published' } }),
      db.webhookDelivery.count({ where: { status: 'dead' } }),
      db.plan.count(),
    ])

  return Response.json({
    overview: {
      tenants: { total: tenantsTotal, active: tenantsActive },
      sessionsThisMonth,
      votesTotal,
      outboxPublished,
      webhooksDead,
      plans,
    },
  })
})
