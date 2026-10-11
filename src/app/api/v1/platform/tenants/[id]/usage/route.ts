/**
 * GET /api/v1/platform/tenants/:id/usage?year=&month= (default: mês corrente)
 * — métricas de uso do tenant na competência: sessões agendadas no mês,
 * parlamentares ativos, artefatos de IA e entregas de webhook, junto dos
 * limites do plano vigente e dos excedentes apurados (base da cobrança de
 * excedentes na fatura). 404 tenant inexistente; 422 período inválido.
 * RBAC: platform.manage (somente platform_owner).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { computeUsage } from '@/lib/server/billing'

export const dynamic = 'force-dynamic'

const usageQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

export const GET = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, _correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params

    const url = new URL(req.url)
    const q = usageQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))

    const tenant = await db.tenant.findUnique({
      where: { id },
      include: { subscription: { include: { plan: true } } },
    })
    if (!tenant) throw notFound(`Tenant "${id}" não encontrado.`)

    const now = new Date()
    const year = q.year ?? now.getUTCFullYear()
    const month = q.month ?? now.getUTCMonth() + 1
    const usage = await computeUsage(tenant.id, year, month)

    return Response.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      period: { year, month },
      plan: tenant.subscription
        ? {
            name: tenant.subscription.plan.name,
            priceCents: tenant.subscription.plan.priceCents,
          }
        : null,
      subscriptionStatus: tenant.subscription?.status ?? null,
      limits: usage.limits,
      usage: {
        sessions: usage.sessions,
        activeParliamentarians: usage.activeParliamentarians,
        aiArtifacts: usage.aiArtifacts,
        webhookDeliveries: usage.webhookDeliveries,
      },
      overage: {
        parliamentarians:
          usage.limits.maxParliamentarians !== null
            ? Math.max(0, usage.activeParliamentarians - usage.limits.maxParliamentarians)
            : 0,
        sessions:
          usage.limits.maxSessionsPerMonth !== null
            ? Math.max(0, usage.sessions - usage.limits.maxSessionsPerMonth)
            : 0,
      },
    })
  }
)
