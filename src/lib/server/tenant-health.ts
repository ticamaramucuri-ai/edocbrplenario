/**
 * Onda 5 / Fase 24 — Health score por tenant (anti-churn), Fórmula CANÔNICA.
 *
 * Compartilhado por TRÊS consumidores que precisam chegar ao MESMO número
 * (critério de aceite: "mesmo banco → mesmo score"):
 *   1. Rotas /platform/tenants/:id/health e /platform/tenants/health (Prisma);
 *   2. prisma/seed.ts (snapshots determinísticos);
 *   3. mini-services/scheduler — SQLite importa a fórmula e o SQL legado;
 *      PostgreSQL reutiliza `gatherTenantHealthMetrics` via Prisma.
 *
 * Fórmula determinística 0–100 (métricas dos últimos 30 dias):
 *   sessões   → min(35, sessões × 12)      (≥3 sessões → 35 pts)
 *   matérias  → min(25, matérias)
 *   logins    → min(30, ⌊logins / 2⌋)      (auditoria auth.login)
 *   webhooks  → min(10, ativos × 5)        (integração viva)
 *   buckets   → saudavel ≥ 70 · atencao ≥ 40 · risco < 40
 *
 * A coleta da aplicação usa filtros Prisma com Date, válidos tanto para SQLite
 * quanto para PostgreSQL. O scheduler SQLite mantém o SQL legado do piloto.
 */
import type { PrismaClient } from '@prisma/client'

export type TenantHealthMetricsInput = {
  sessions30d: number
  matters30d: number
  logins30d: number
  activeWebhooks: number
}

export type TenantHealthBucket = 'saudavel' | 'atencao' | 'risco'

/** Parte PURA — sem dependências; importável pelo scheduler Bun. */
export function healthScoreFromMetrics(m: TenantHealthMetricsInput): {
  score: number
  bucket: TenantHealthBucket
} {
  const sessions = Math.min(35, m.sessions30d * 12)
  const matters = Math.min(25, m.matters30d)
  const logins = Math.min(30, Math.floor(m.logins30d / 2))
  const webhooks = Math.min(10, m.activeWebhooks * 5)
  const score = Math.max(0, Math.min(100, Math.round(sessions + matters + logins + webhooks)))
  const bucket: TenantHealthBucket = score >= 70 ? 'saudavel' : score >= 40 ? 'atencao' : 'risco'
  return { score, bucket }
}

/**
 * SQL SQLite dos contadores do scheduler (parâmetro posicional `?` = tenantId).
 * DateTime no SQLite/Prisma é epoch em milissegundos.
 */
export const TENANT_HEALTH_SQL = {
  sessions30d:
    "SELECT COUNT(*) AS n FROM Session WHERE tenantId = ? AND scheduledAt >= (strftime('%s','now') - 30*86400) * 1000",
  matters30d:
    "SELECT COUNT(*) AS n FROM LegislativeMatter WHERE tenantId = ? AND createdAt >= (strftime('%s','now') - 30*86400) * 1000",
  logins30d:
    "SELECT COUNT(*) AS n FROM AuditEvent WHERE tenantId = ? AND action = 'auth.login' AND createdAt >= (strftime('%s','now') - 30*86400) * 1000",
  activeWebhooks: 'SELECT COUNT(*) AS n FROM WebhookEndpoint WHERE tenantId = ? AND active = 1',
} as const

/** Coleta as métricas por tenant via Prisma (rotas e seed, ambos os provedores). */
export async function gatherTenantHealthMetrics(
  db: PrismaClient,
  tenantId: string,
  referenceTime: Date = new Date()
): Promise<TenantHealthMetricsInput> {
  const since = new Date(referenceTime.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [sessions30d, matters30d, logins30d, activeWebhooks] = await Promise.all([
    db.session.count({ where: { tenantId, scheduledAt: { gte: since } } }),
    db.legislativeMatter.count({ where: { tenantId, createdAt: { gte: since } } }),
    db.auditEvent.count({ where: { tenantId, action: 'auth.login', createdAt: { gte: since } } }),
    db.webhookEndpoint.count({ where: { tenantId, active: true } }),
  ])
  return {
    sessions30d, matters30d, logins30d, activeWebhooks,
  }
}

/** Health completo (recompute determinístico) — usado por rotas e seed. */
export async function computeTenantHealth(
  db: PrismaClient,
  tenant: { id: string; name: string; slug: string }
): Promise<{
  tenantId: string
  tenantName: string
  slug: string
  score: number
  bucket: TenantHealthBucket
  metrics: TenantHealthMetricsInput
}> {
  const metrics = await gatherTenantHealthMetrics(db, tenant.id)
  const { score, bucket } = healthScoreFromMetrics(metrics)
  return { tenantId: tenant.id, tenantName: tenant.name, slug: tenant.slug, score, bucket, metrics }
}
