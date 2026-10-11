import { afterAll, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import { gatherTenantHealthMetrics, healthScoreFromMetrics, TENANT_HEALTH_SQL } from '@/lib/server/tenant-health'

afterAll(async () => { await db.$disconnect() })

test('contadores Prisma preservam recorte temporal e isolamento entre Câmaras', async () => {
  const suffix = crypto.randomUUID()
  const tenantA = await db.tenant.create({ data: { slug: `health-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const tenantB = await db.tenant.create({ data: { slug: `health-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const now = new Date()
  const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
  const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)
  for (const [tenantId, number, scheduledAt] of [
    [tenantA.id, 1, recent], [tenantA.id, 2, old], [tenantB.id, 1, recent],
  ] as const) {
    await db.session.create({ data: { tenantId, number, year: 2026, scheduledAt } })
    await db.legislativeMatter.create({ data: { tenantId, type: 'projeto_de_lei', number, year: 2026,
      ementa: `Matéria ${number}`, authors: '[]', createdAt: scheduledAt } })
    await db.auditEvent.create({ data: { tenantId, actorName: 'Teste', actorRole: 'tenant_admin', action: 'auth.login',
      aggregateType: 'auth', summary: 'Login de teste', chainHash: `${tenantId}-${number}`, createdAt: scheduledAt } })
  }
  await db.webhookEndpoint.create({ data: { tenantId: tenantA.id, url: 'https://example.invalid/a', secret: 'test-only', events: '[]', active: true } })
  await db.webhookEndpoint.create({ data: { tenantId: tenantA.id, url: 'https://example.invalid/b', secret: 'test-only', events: '[]', active: false } })
  await db.webhookEndpoint.create({ data: { tenantId: tenantB.id, url: 'https://example.invalid/c', secret: 'test-only', events: '[]', active: true } })

  const a = await gatherTenantHealthMetrics(db, tenantA.id, now)
  const b = await gatherTenantHealthMetrics(db, tenantB.id, now)
  expect(a).toEqual({ sessions30d: 1, matters30d: 1, logins30d: 1, activeWebhooks: 1 })
  expect(b).toEqual({ sessions30d: 1, matters30d: 1, logins30d: 1, activeWebhooks: 1 })
  expect(healthScoreFromMetrics(a)).toEqual({ score: 18, bucket: 'risco' })

  // Enquanto o scheduler usa SQLite, seu resultado precisa coincidir com o da aplicação.
  for (const [key, sql] of Object.entries(TENANT_HEALTH_SQL)) {
    const rows = await db.$queryRawUnsafe<Array<{ n: number | bigint }>>(sql, tenantA.id)
    expect(Number(rows[0]?.n ?? 0)).toBe(a[key as keyof typeof a])
  }
})
