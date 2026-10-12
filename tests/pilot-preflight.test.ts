import { afterAll, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import { inspectPilotPreflight } from '@/lib/server/pilot-preflight'

afterAll(async () => { await db.$disconnect() })

test('pré-voo é isolado por Câmara e não declara aceite institucional', async () => {
  const suffix = crypto.randomUUID()
  const a = await db.tenant.create({ data: { slug: `pilot-a-${suffix}`, name: 'Câmara A', city: 'A', uf: 'BA' } })
  const b = await db.tenant.create({ data: { slug: `pilot-b-${suffix}`, name: 'Câmara B', city: 'B', uf: 'BA' } })
  await Promise.all(['tenant_admin', 'session_operator', 'media_operator'].map((role, index) =>
    db.user.create({ data: { tenantId: b.id, role, name: `Operador ${index}`, email: `pilot-${index}-${suffix}@example.invalid` } })))
  await db.session.create({ data: { tenantId: b.id, number: 1, year: 2039, official: true,
    status: 'draft', scheduledAt: new Date('2039-01-01T12:00:00Z') } })
  const reportA = await inspectPilotPreflight(db, a.slug, { DATABASE_URL: 'file:/tmp/pilot.db' })
  const reportB = await inspectPilotPreflight(db, b.slug, { DATABASE_URL: 'postgresql://example.invalid/test' })
  expect(reportA.checks.find((check) => check.id === 'roles')?.ok).toBe(false)
  expect(reportB.checks.find((check) => check.id === 'roles')?.ok).toBe(true)
  expect(reportA.facts.officialSessions).toBe(0)
  expect(reportB.facts.officialSessions).toBe(1)
  expect(reportA.checks.find((check) => check.id === 'postgresql')?.ok).toBe(false)
  expect(reportB.checks.find((check) => check.id === 'postgresql')?.ok).toBe(true)
  expect(reportB.automaticReady).toBe(false)
  expect(reportB.institutionalPilotApproved).toBe(false)
  expect(JSON.stringify(reportB)).not.toContain('pilot-0-')
})
