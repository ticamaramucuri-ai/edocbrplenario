import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('pré-voo detecta foto e anexo ausentes somente na Câmara consultada', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'edocbr-pilot-assets-'))
  try {
    const suffix = crypto.randomUUID()
    const tenant = await db.tenant.create({ data: { slug: `assets-${suffix}`, name: 'Câmara de ensaio', city: 'Teste', uf: 'BA' } })
    const other = await db.tenant.create({ data: { slug: `assets-other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
    const filename = `${crypto.randomUUID()}.webp`
    await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Pessoa fictícia', party: 'SEM',
      photoUrl: `/api/v1/public/parliamentarian-images/${tenant.id}/${filename}` } })
    const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei',
      number: 1, year: 2039, ementa: 'Matéria de ensaio', authors: '[]' } })
    await db.matterAttachment.create({ data: { matterId: matter.id, name: 'Anexo', url: '/anexo.pdf', sizeBytes: 5 } })
    const roots = { images: join(directory, 'images'), public: join(directory, 'public') }
    await mkdir(roots.images)
    await mkdir(roots.public)
    const missing = await inspectPilotPreflight(db, tenant.slug, { DATABASE_URL: 'file:/tmp/pilot.db' }, roots)
    expect(missing.checks.find((check) => check.id === 'asset_references')?.ok).toBe(false)
    expect(missing.checks.find((check) => check.id === 'asset_references')?.detail).toContain('1 ausente(s)')
    const isolated = await inspectPilotPreflight(db, other.slug, { DATABASE_URL: 'file:/tmp/pilot.db' }, roots)
    expect(isolated.checks.find((check) => check.id === 'asset_references')?.ok).toBe(true)

    await mkdir(join(roots.images, tenant.id))
    await writeFile(join(roots.images, tenant.id, filename), 'webp')
    await writeFile(join(roots.public, 'anexo.pdf'), 'cinco')
    const restored = await inspectPilotPreflight(db, tenant.slug, { DATABASE_URL: 'file:/tmp/pilot.db' }, roots)
    expect(restored.checks.find((check) => check.id === 'asset_references')?.ok).toBe(true)
    await writeFile(join(roots.public, 'anexo.pdf'), 'mal')
    const altered = await inspectPilotPreflight(db, tenant.slug, { DATABASE_URL: 'file:/tmp/pilot.db' }, roots)
    expect(altered.checks.find((check) => check.id === 'asset_references')?.ok).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
