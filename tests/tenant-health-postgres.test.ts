import { afterAll, expect, test } from 'bun:test'
import type { PrismaClient } from '@prisma/client'
import { gatherTenantHealthMetrics, healthScoreFromMetrics } from '@/lib/server/tenant-health'

const clientModule = await import(process.env.POSTGRES_TEST_CLIENT!)
const db = new clientModule.PrismaClient() as PrismaClient
afterAll(async () => { await db.$disconnect() })

test('coleta de saúde da aplicação usa o mesmo contrato em PostgreSQL', async () => {
  const suffix = crypto.randomUUID()
  const a = await db.tenant.create({ data: { slug: `pg-health-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const b = await db.tenant.create({ data: { slug: `pg-health-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const now = new Date()
  const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
  const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { tenantId: a.id, number: 1, year: 2026, scheduledAt: recent } })
  await db.session.create({ data: { tenantId: a.id, number: 2, year: 2026, scheduledAt: old } })
  await db.session.create({ data: { tenantId: b.id, number: 1, year: 2026, scheduledAt: recent } })
  await db.legislativeMatter.create({ data: { tenantId: a.id, type: 'projeto_de_lei', number: 1, year: 2026,
    ementa: 'Teste', authors: '[]', createdAt: recent } })
  await db.auditEvent.create({ data: { tenantId: a.id, actorName: 'Teste', actorRole: 'tenant_admin', action: 'auth.login',
    aggregateType: 'auth', summary: 'Teste', chainHash: suffix, createdAt: recent } })
  await db.webhookEndpoint.create({ data: { tenantId: a.id, url: 'https://example.invalid', secret: 'test-only', events: '[]', active: true } })
  expect(await gatherTenantHealthMetrics(db, a.id, now)).toEqual({ sessions30d: 1, matters30d: 1, logins30d: 1, activeWebhooks: 1 })
  expect(await gatherTenantHealthMetrics(db, b.id, now)).toEqual({ sessions30d: 1, matters30d: 0, logins30d: 0, activeWebhooks: 0 })
  expect(healthScoreFromMetrics(await gatherTenantHealthMetrics(db, a.id, now))).toEqual({ score: 18, bucket: 'risco' })
})
