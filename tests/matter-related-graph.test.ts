import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as listRelated, POST as createRelated, DELETE as deleteRelated } from '@/app/api/v1/matters/[id]/related/route'

afterAll(async () => { await db.$disconnect() })

const context = (id: string) => ({ params: Promise.resolve({ id }) })
const request = (url: string, actorId: string, method = 'GET', body?: unknown) => new NextRequest(url, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})

test('vínculos legislativos respeitam papéis, tenant, ciclo, reciprocidade e auditoria', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `related-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const otherTenant = await db.tenant.create({ data: { slug: `related-out-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Legislativo', email: `related-${suffix}@example.invalid`, role: 'legislative_admin' } })
  const reader = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `related-read-${suffix}@example.invalid`, role: 'session_operator' } })
  const outsider = await db.user.create({ data: { tenantId: otherTenant.id, name: 'Outra Câmara', email: `related-out-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const makeMatter = (tenantId: string, number: number) => db.legislativeMatter.create({ data: {
    tenantId, type: 'projeto_de_lei', number, year: 2026, ementa: `Matéria de ensaio ${number} ${suffix}`, authors: '[]',
  } })
  const [a, b, c, d, foreign] = await Promise.all([
    makeMatter(tenant.id, 1), makeMatter(tenant.id, 2), makeMatter(tenant.id, 3), makeMatter(tenant.id, 4), makeMatter(otherTenant.id, 1),
  ])
  const post = (actorId: string, sourceId: string, targetId: string, kind = 'emenda') => createRelated(
    request(`http://localhost/api/v1/matters/${sourceId}/related`, actorId, 'POST', { relatedMatterId: targetId, kind, notes: 'Vínculo de ensaio.' }), context(sourceId))

  expect((await post(reader.id, a.id, b.id)).status).toBe(403)
  expect((await post(admin.id, a.id, foreign.id)).status).toBe(403)
  const self = await post(admin.id, a.id, a.id)
  expect(self.status).toBe(422)
  expect((await self.json()).errors.relatedMatterId).toBeDefined()
  expect((await post(admin.id, a.id, b.id, 'invalido')).status).toBe(422)

  const ab = await post(admin.id, a.id, b.id)
  expect(ab.status).toBe(201)
  const abRelated = (await ab.json()).related
  expect(abRelated).toMatchObject({ kind: 'emenda', direction: 'from', matter: { id: b.id } })
  expect((await post(admin.id, b.id, c.id, 'regula')).status).toBe(201)

  const duplicateReverse = await post(admin.id, b.id, a.id)
  expect(duplicateReverse.status).toBe(422)
  expect((await duplicateReverse.json()).code).toBe('MATTER_CYCLE')
  const indirectCycle = await post(admin.id, c.id, a.id)
  expect(indirectCycle.status).toBe(422)
  const cycleProblem = await indirectCycle.json()
  expect(cycleProblem.code).toBe('MATTER_CYCLE')
  expect(cycleProblem.path).toHaveLength(4)

  const asTarget = await listRelated(request(`http://localhost/api/v1/matters/${b.id}/related`, reader.id), context(b.id))
  expect((await asTarget.json()).related.map((row: { direction: string; matter: { id: string } }) => row))
    .toContainEqual(expect.objectContaining({ direction: 'to', matter: expect.objectContaining({ id: a.id }) }))
  expect((await listRelated(request(`http://localhost/api/v1/matters/${a.id}/related`, outsider.id), context(a.id))).status).toBe(403)

  const cd = await post(admin.id, c.id, d.id)
  expect(cd.status).toBe(201)
  const cdRow = (await cd.json()).related
  expect((await deleteRelated(request(`http://localhost/api/v1/matters/${d.id}/related?relatedId=${cdRow.id}`, reader.id, 'DELETE'), context(d.id))).status).toBe(403)
  expect((await deleteRelated(request(`http://localhost/api/v1/matters/${a.id}/related?relatedId=${cdRow.id}`, admin.id, 'DELETE'), context(a.id))).status).toBe(404)
  expect((await deleteRelated(request(`http://localhost/api/v1/matters/${d.id}/related`, admin.id, 'DELETE'), context(d.id))).status).toBe(422)
  const removed = await deleteRelated(request(`http://localhost/api/v1/matters/${d.id}/related?relatedId=${cdRow.id}`, admin.id, 'DELETE'), context(d.id))
  expect(removed.status).toBe(200)
  expect((await removed.json()).ok).toBe(true)
  const removedFromList = await listRelated(request(`http://localhost/api/v1/matters/${c.id}/related`, reader.id), context(c.id))
  expect((await removedFromList.json()).related).toEqual([
    expect.objectContaining({ kind: 'regula', direction: 'to', matter: expect.objectContaining({ id: b.id }) }),
  ])
  expect(await db.auditEvent.count({ where: { action: 'matter.related', aggregateId: { in: [a.id, b.id, c.id, d.id] } } })).toBe(3)
  expect(await db.auditEvent.count({ where: { action: 'matter.related_removed' } })).toBe(1)

  const supportedKinds = ['altera', 'revoga', 'regula', 'subsidiaria', 'emenda', 'substitutivo'] as const
  for (let index = 0; index < supportedKinds.length; index++) {
    const source = await makeMatter(tenant.id, 5 + index * 2)
    const target = await makeMatter(tenant.id, 6 + index * 2)
    const created = await post(admin.id, source.id, target.id, supportedKinds[index])
    expect(created.status).toBe(201)
    expect((await created.json()).related.kind).toBe(supportedKinds[index])
  }
})
