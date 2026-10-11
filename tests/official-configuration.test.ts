import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as inspect, POST as approve } from '@/app/api/v1/official-configuration/route'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'

afterAll(async () => { await db.$disconnect() })

test('aprovação versionada isola Câmara e bloqueia publicação oficial após mudança', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: {
    slug: `oficial-${suffix}`, name: 'Câmara de Ensaio', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 1, votingPoliciesByMatterType: { projeto_de_lei: { rule: 'maioria_simples', quorumMinimum: 1 } } }),
  } })
  const other = await db.tenant.create({ data: { slug: `outra-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `oficial-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Outro', email: `outra-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente', party: 'ABC', boardRole: 'presidente' } })
  const secretary = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Secretária', party: 'ABC', boardRole: 'primeiro_secretario' } })
  const parliament = await db.legislature.create({ data: { tenantId: tenant.id, number: 1, startYear: 2025, endYear: 2028, current: true } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Ensaio', authors: '[]' } })
  const headers = (id: string) => ({ 'content-type': 'application/json', 'x-actor-id': id })
  const query = (id: string) => inspect(new NextRequest('http://localhost/api/v1/official-configuration', { headers: headers(id) }), { params: Promise.resolve({}) })
  const approval = (id: string, hash: string) => approve(new NextRequest('http://localhost/api/v1/official-configuration', {
    method: 'POST', headers: headers(id), body: JSON.stringify({ expectedSha256: hash, approvalReference: 'Portaria 1/2026', acknowledged: true }),
  }), { params: Promise.resolve({}) })
  const initial = await (await query(admin.id)).json()
  expect(initial.ready).toBe(false)
  expect(initial.checks.find((c: { id: string }) => c.id === 'mandates').ok).toBe(false)
  expect((await approval(admin.id, initial.snapshotSha256)).status).toBe(409)
  await db.party.create({ data: { tenantId: tenant.id, acronym: 'ABC', name: 'Partido ABC' } })
  for (const member of [president, secretary]) {
    await db.mandate.create({ data: { tenantId: tenant.id, legislatureId: parliament.id, parliamentarianId: member.id, startDate: new Date('2025-01-01') } })
  }
  for (const [role, member] of [['presidente', president], ['primeiro_secretario', secretary]] as const) {
    await db.boardPosition.create({ data: { tenantId: tenant.id, legislatureId: parliament.id, parliamentarianId: member.id, role, startDate: new Date('2025-01-01') } })
  }
  const ready = await (await query(admin.id)).json()
  expect(ready.ready).toBe(true)
  expect((await approval(outsider.id, ready.snapshotSha256)).status).toBe(409)
  expect((await approval(admin.id, initial.snapshotSha256)).status).toBe(409)
  expect((await approval(admin.id, ready.snapshotSha256)).status).toBe(201)
  expect((await (await query(admin.id)).json()).approved).toBe(true)
  const created = await createSession(new NextRequest('http://localhost/api/v1/sessions', { method: 'POST', headers: headers(admin.id),
    body: JSON.stringify({ type: 'ordinaria', scheduledAt: '2027-06-01T20:00:00.000Z', presidentId: president.id, matterIds: [matter.id], official: true }),
  }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const session = (await created.json()).session
  expect(session.official).toBe(true)
  await db.party.update({ where: { tenantId_acronym: { tenantId: tenant.id, acronym: 'ABC' } }, data: { active: false } })
  const context = { params: Promise.resolve({ id: session.id as string }) }
  const publish = () => transitionSession(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/transition`, {
    method: 'POST', headers: headers(admin.id), body: JSON.stringify({ action: 'schedule', version: 1 }),
  }), context)
  expect((await publish()).status).toBe(409)
  await db.party.update({ where: { tenantId_acronym: { tenantId: tenant.id, acronym: 'ABC' } }, data: { active: true } })
  await db.party.update({ where: { tenantId_acronym: { tenantId: tenant.id, acronym: 'ABC' } }, data: { name: 'Partido ABC Atualizado' } })
  expect((await (await query(admin.id)).json()).ready).toBe(true)
  expect((await (await query(admin.id)).json()).approved).toBe(false)
  expect((await publish()).status).toBe(409)
  const refreshed = await (await query(admin.id)).json()
  expect((await approval(admin.id, refreshed.snapshotSha256)).status).toBe(201)
  expect((await publish()).status).toBe(200)
  const published = await db.session.findUniqueOrThrow({ where: { id: session.id } })
  expect(published.officialConfigurationId).toBeTruthy()
  expect(await db.officialConfigurationRevision.count({ where: { tenantId: other.id } })).toBe(0)
})
