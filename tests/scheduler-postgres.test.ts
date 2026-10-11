import { afterAll, expect, test } from 'bun:test'
import type { PrismaClient } from '@prisma/client'
import { createPostgresScheduler } from '../mini-services/scheduler/postgres-core'

const clientModule = await import(process.env.POSTGRES_TEST_CLIENT!)
const db = new clientModule.PrismaClient() as PrismaClient
afterAll(async () => { await db.$disconnect() })

test('scheduler PostgreSQL aplica regras por Câmara, evita alertas duplicados e avança jobs', async () => {
  const suffix = crypto.randomUUID()
  const now = new Date()
  const a = await db.tenant.create({ data: { slug: `sc-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const b = await db.tenant.create({ data: { slug: `sc-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  await db.invoice.create({ data: { tenantId: a.id, number: 1, periodYear: 2026, periodMonth: 10, dueAt: new Date(now.getTime() - 4 * 86400_000) } })
  const session = await db.session.create({ data: { tenantId: b.id, number: 99, year: 2026, status: 'scheduled', scheduledAt: new Date(now.getTime() + 86400_000) } })
  const endpoint = await db.webhookEndpoint.create({ data: { tenantId: b.id, url: 'https://example.invalid/scheduler', secret: 'test', events: '[]' } })
  await db.webhookDelivery.create({ data: { endpointId: endpoint.id, eventType: 'test.dead', payload: '{}', status: 'dead' } })
  const exportJob = await db.exportJob.create({ data: { tenantId: a.id, status: 'running', createdAt: new Date(now.getTime() - 11 * 60_000) } })
  const scheduler = createPostgresScheduler(db, async (url) => !url.includes('3003'))

  expect((await scheduler.runKind('alert.scan', now)).status).toBe('ok')
  const ownAlerts = await db.platformAlert.findMany({ where: { ackAt: null } })
  const parsed = ownAlerts.map((alert) => ({ kind: alert.kind, meta: JSON.parse(alert.meta) as Record<string, string> }))
  expect(parsed).toContainEqual({ kind: 'billing.invoice_overdue', meta: expect.objectContaining({ tenantId: a.id }) })
  expect(parsed).toContainEqual({ kind: 'session.no_agenda', meta: expect.objectContaining({ sessionId: session.id, tenantId: b.id }) })
  expect(parsed).toContainEqual({ kind: 'webhook.dead_letter', meta: expect.objectContaining({ endpointId: endpoint.id, tenantId: b.id }) })
  const alertCount = await db.platformAlert.count()
  await scheduler.runKind('alert.scan', now)
  expect(await db.platformAlert.count()).toBe(alertCount)

  expect((await scheduler.runKind('export.watchdog', now)).status).toBe('ok')
  expect(await db.exportJob.findUniqueOrThrow({ where: { id: exportJob.id } })).toMatchObject({ status: 'failed' })
  expect(await db.platformAlert.count({ where: { kind: 'export.orphan' } })).toBe(1)
  await scheduler.runKind('export.watchdog', now)
  expect(await db.platformAlert.count({ where: { kind: 'export.orphan' } })).toBe(1)

  expect((await scheduler.runKind('health.check', now)).status).toBe('error')
  expect(await db.platformAlert.count({ where: { kind: 'service.degraded', meta: JSON.stringify({ service: 'realtime' }) } })).toBe(1)
  await scheduler.runKind('tenant.health_snapshot', now)
  const snapshotsA = await db.tenantHealthSnapshot.findMany({ where: { tenantId: a.id } })
  const snapshotsB = await db.tenantHealthSnapshot.findMany({ where: { tenantId: b.id } })
  expect(snapshotsA).toHaveLength(1)
  expect(snapshotsB).toHaveLength(1)
  await scheduler.runKind('tenant.health_snapshot', now)
  expect(await db.tenantHealthSnapshot.count({ where: { tenantId: a.id } })).toBe(1)

  const scheduled = await db.scheduledJob.create({ data: {
    kind: `health.check.test.${suffix}`, title: 'Kind inválido', everySeconds: 60,
    nextRunAt: new Date(now.getTime() - 1000),
  } })
  expect(await scheduler.tick(now)).toBe(1)
  const after = await db.scheduledJob.findUniqueOrThrow({ where: { id: scheduled.id } })
  expect(after.lastStatus).toBe('error')
  expect(after.nextRunAt.getTime()).toBeGreaterThan(now.getTime())
  expect(await scheduler.tick(now)).toBe(0)

  const expired = await db.scheduledJob.create({ data: { kind: `invalid.lease.${suffix}`, title: 'Lease vencido',
    everySeconds: 60, nextRunAt: new Date(now.getTime() - 1000), leaseOwner: 'worker-morto',
    leaseUntil: new Date(now.getTime() - 1000) } })
  expect(await scheduler.tick(now)).toBe(1)
  expect((await db.scheduledJob.findUniqueOrThrow({ where: { id: expired.id } })).leaseOwner).toBeNull()

  const manual = await db.scheduledJob.create({ data: { kind: 'health.check', title: 'Saúde', active: false,
    nextRunAt: new Date(now.getTime() + 60_000) } })
  const slowScheduler = createPostgresScheduler(db, async () => { await Bun.sleep(80); return true })
  const results = await Promise.all([slowScheduler.runManual('health.check'), slowScheduler.runManual('health.check')])
  expect(results.map(result => result.status).sort()).toEqual(['ok', 'skipped'])
  expect((await db.scheduledJob.findUniqueOrThrow({ where: { id: manual.id } })).nextRunAt.getTime()).toBe(now.getTime() + 60_000)
})
