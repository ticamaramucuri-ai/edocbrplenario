import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createMember, GET as listMembers } from '@/app/api/v1/parliamentarians/route'
import { PATCH as editParty } from '@/app/api/v1/parties/[id]/route'
import { imageUrl } from '@/lib/server/parliamentarian-images'

afterAll(async () => { await db.$disconnect() })
const request = (path: string, actorId: string, method: string, body?: unknown) => new NextRequest(`http://localhost/api/v1/${path}`, {
  method, headers: { 'x-actor-id': actorId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

test('emblema por partido propaga aos membros e não atravessa Câmaras', async () => {
  const [a, b] = await Promise.all(['a', 'b'].map(async slug => {
    const tenant = await db.tenant.create({ data: { slug: `emblem-${slug}-${crypto.randomUUID()}`, name: slug, city: 'Teste', uf: 'BA' } })
    const actor = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `${slug}-${crypto.randomUUID()}@example.invalid`, role: 'tenant_admin' } })
    return { tenant, actor }
  }))
  const logo1 = imageUrl(a.tenant.id, '26a61cee-368b-43f0-b690-9f8a1b8137b4.webp')
  const logo2 = imageUrl(a.tenant.id, '36a61cee-368b-43f0-b690-9f8a1b8137b4.webp')
  const other = imageUrl(b.tenant.id, '46a61cee-368b-43f0-b690-9f8a1b8137b4.webp')
  expect((await createMember(request('parliamentarians', a.actor.id, 'POST', { name: 'Maria Silva', party: 'PSD', partyEmblemUrl: other }), { params: Promise.resolve({}) })).status).toBe(422)
  expect((await createMember(request('parliamentarians', a.actor.id, 'POST', { name: 'Maria Silva', party: 'PSD', partyEmblemUrl: logo1 }), { params: Promise.resolve({}) })).status).toBe(201)
  expect((await createMember(request('parliamentarians', a.actor.id, 'POST', { name: 'João Souza', party: 'PSD' }), { params: Promise.resolve({}) })).status).toBe(201)
  expect((await createMember(request('parliamentarians', b.actor.id, 'POST', { name: 'Ana Costa', party: 'PSD', partyEmblemUrl: other }), { params: Promise.resolve({}) })).status).toBe(201)
  const party = await db.party.findUniqueOrThrow({ where: { tenantId_acronym: { tenantId: a.tenant.id, acronym: 'PSD' } } })
  expect(party.emblemUrl).toBe(logo1)
  expect((await editParty(request(`parties/${party.id}`, a.actor.id, 'PATCH', { emblemUrl: logo2 }), { params: Promise.resolve({ id: party.id }) })).status).toBe(200)
  const members = await db.parliamentarian.findMany({ where: { tenantId: a.tenant.id } })
  expect(members.map(m => m.partyEmblemUrl)).toEqual([logo2, logo2])
  expect((await db.parliamentarian.findFirstOrThrow({ where: { tenantId: b.tenant.id } })).partyEmblemUrl).toBe(other)
  expect((await editParty(request(`parties/${party.id}`, b.actor.id, 'PATCH', { emblemUrl: other }), { params: Promise.resolve({ id: party.id }) })).status).toBe(403)
  expect((await listMembers(request('parliamentarians', a.actor.id, 'GET'), { params: Promise.resolve({}) })).status).toBe(200)
})
