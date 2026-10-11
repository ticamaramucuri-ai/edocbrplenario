/**
 * GET /api/v1/platform/tenants/health — painel anti-churn da Fase 24.
 * RBAC platform.read (owner + support).
 *
 * Para CADA tenant ativo: recomputação determinística do health score na
 * hora via `computeTenantHealth` (fórmula CANÔNICA de
 * src/lib/server/tenant-health.ts — a mesma do seed e do scheduler :3005;
 * "mesmo banco → mesmo score") + `trend` = score atual − score do último
 * TenantHealthSnapshot registrado (null quando o tenant nunca teve captura).
 * `capturedAt` = instante do recompute (nada é persistido aqui — capturas
 * são diárias pelo scheduler ou forçadas via POST /platform/tenants/:id/health).
 *
 * Rota ESTÁTICA: no App Router, `tenants/health` tem precedência sobre
 * `tenants/[id]` — não conflita com o route.ts do outro time.
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { computeTenantHealth } from '@/lib/server/tenant-health'
import type { TenantHealthView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  const tenants = await db.tenant.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, slug: true },
  })

  const capturedAt = new Date()
  const views: TenantHealthView[] = []
  for (const tenant of tenants) {
    const health = await computeTenantHealth(db, tenant)
    const last = await db.tenantHealthSnapshot.findFirst({
      where: { tenantId: tenant.id },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      select: { score: true },
    })
    views.push({
      tenantId: health.tenantId,
      tenantName: health.tenantName,
      slug: health.slug,
      score: health.score,
      bucket: health.bucket,
      metrics: health.metrics,
      trend: last ? health.score - last.score : null,
      capturedAt: capturedAt.toISOString(),
    })
  }

  return Response.json({ tenants: views })
})
