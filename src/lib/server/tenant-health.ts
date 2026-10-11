/**
 * Onda 5 / Fase 24 — Health score por tenant (anti-churn), Fórmula CANÔNICA.
 *
 * Compartilhado por TRÊS consumidores que precisam chegar ao MESMO número
 * (critério de aceite: "mesmo banco → mesmo score"):
 *   1. Rotas /platform/tenants/:id/health e /platform/tenants/health (Prisma);
 *   2. prisma/seed.ts (snapshots determinísticos);
 *   3. mini-services/scheduler (bun:sqlite) — importa SOMENTE a função pura
 *      `healthScoreFromMetrics` e as constantes SQL abaixo (import type é
 *      apagado em runtime, então o arquivo é seguro sob Bun sem alias).
 *
 * Fórmula determinística 0–100 (métricas dos últimos 30 dias):
 *   sessões   → min(35, sessões × 12)      (≥3 sessões → 35 pts)
 *   matérias  → min(25, matérias)
 *   logins    → min(30, ⌊logins / 2⌋)      (auditoria auth.login)
 *   webhooks  → min(10, ativos × 5)        (integração viva)
 *   buckets   → saudavel ≥ 70 · atencao ≥ 40 · risco < 40
 *
 * IMPORTANTE (SQLite/Prisma): DateTime é armazenado como epoch MILLISSECONDS
 * (INTEGER) — o corte de 30 dias usa `(strftime('%s','now') - 30*86400)*1000`,
 * NÃO datetime('now','-30 days') (que produz string ISO e compararia errado).
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
 * SQL canônico dos contadores (parâmetro posicional `?` = tenantId).
 * Idêntico no Prisma ($queryRawUnsafe) e no bun:sqlite do scheduler.
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

/** Coleta as métricas via Prisma com o SQL canônico (rotas e seed). */
export async function gatherTenantHealthMetrics(
  db: PrismaClient,
  tenantId: string
): Promise<TenantHealthMetricsInput> {
  const one = async (sql: string): Promise<number> => {
    const rows = (await db.$queryRawUnsafe(sql, tenantId)) as Array<{ n: number | bigint }>
    return Number(rows[0]?.n ?? 0)
  }
  return {
    sessions30d: await one(TENANT_HEALTH_SQL.sessions30d),
    matters30d: await one(TENANT_HEALTH_SQL.matters30d),
    logins30d: await one(TENANT_HEALTH_SQL.logins30d),
    activeWebhooks: await one(TENANT_HEALTH_SQL.activeWebhooks),
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
