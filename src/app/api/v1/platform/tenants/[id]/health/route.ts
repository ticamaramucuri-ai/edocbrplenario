/**
 * GET/POST /api/v1/platform/tenants/:id/health — health de UM tenant (F24).
 *
 *  - GET (platform.read): recomputação determinística na hora + tendência vs.
 *    o último TenantHealthSnapshot anterior (null se nunca houve). 404 se o
 *    tenant não existir. Nada é persistido.
 *  - POST (platform.manage): CAPTURA FORÇADA — insere um TenantHealthSnapshot
 *    com score/metrics do recompute (além da captura diária do scheduler
 *    :3005, kind tenant.health_snapshot) e responde o TenantHealthView com o
 *    `capturedAt` da captura gravada. `trend` compara com o último snapshot
 *    ANTERIOR à captura (computado antes do insert).
 *
 * Subpasta de `platform/tenants/[id]/` — o route.ts raiz da pasta é de outro
 * time (Fase 8/16) e permanece intocado.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { computeTenantHealth } from '@/lib/server/tenant-health'
import type { TenantHealthView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<Record<string, string>> }

async function loadTenant(id: string) {
  const tenant = await db.tenant.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true },
  })
  if (!tenant) throw notFound('Tenant não encontrado.')
  return tenant
}

async function lastSnapshotScore(tenantId: string): Promise<number | null> {
  const last = await db.tenantHealthSnapshot.findFirst({
    where: { tenantId },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    select: { score: true },
  })
  return last ? last.score : null
}

export const GET = apiHandler(async (req: Request, ctx: Ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')
  const { id } = await ctx.params

  const tenant = await loadTenant(id)
  const health = await computeTenantHealth(db, tenant)
  const previous = await lastSnapshotScore(tenant.id)

  const view: TenantHealthView = {
    tenantId: health.tenantId,
    tenantName: health.tenantName,
    slug: health.slug,
    score: health.score,
    bucket: health.bucket,
    metrics: health.metrics,
    trend: previous !== null ? health.score - previous : null,
    capturedAt: new Date().toISOString(),
  }
  return Response.json(view)
})

export const POST = apiHandler(async (req: Request, ctx: Ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')
  const { id } = await ctx.params

  const tenant = await loadTenant(id)
  const health = await computeTenantHealth(db, tenant)
  // Tendência vs. o último snapshot ANTERIOR (computada antes do insert).
  const previous = await lastSnapshotScore(tenant.id)

  const snapshot = await db.tenantHealthSnapshot.create({
    data: {
      tenantId: tenant.id,
      score: health.score,
      metrics: JSON.stringify(health.metrics),
      capturedAt: new Date(),
    },
  })

  const view: TenantHealthView = {
    tenantId: health.tenantId,
    tenantName: health.tenantName,
    slug: health.slug,
    score: health.score,
    bucket: health.bucket,
    metrics: health.metrics,
    trend: previous !== null ? health.score - previous : null,
    capturedAt: snapshot.capturedAt.toISOString(),
  }
  return Response.json(view)
})
