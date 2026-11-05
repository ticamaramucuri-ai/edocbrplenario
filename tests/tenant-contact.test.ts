import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PATCH } from '@/app/api/v1/tenants/[id]/route'

afterAll(async () => { await db.$disconnect() })

test('contatos institucionais são validados e isolados por Câmara', async () => {
  const suffix = crypto.randomUUID()
  const first = await db.tenant.create({ data: { slug: `contact-a-${suffix}`, name: 'Câmara A', city: 'A', uf: 'BA' } })
  const second = await db.tenant.create({ data: { slug: `contact-b-${suffix}`, name: 'Câmara B', city: 'B', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: first.id, name: 'Admin A',
    email: `contact-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const patch = (id: string, contact: object) => PATCH(new NextRequest(`http://localhost/api/v1/tenants/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'x-actor-id': admin.id },
    body: JSON.stringify({ contact }),
  }), { params: Promise.resolve({ id }) })

  expect((await patch(first.id, { websiteUrl: 'javascript:alert(1)' })).status).toBe(422)
  expect((await patch(second.id, { generalEmail: 'a@example.org' })).status).toBe(403)
  const response = await patch(first.id, { address: 'Rua 1', postalCode: '45.930-000',
    generalEmail: 'camara@example.org', websiteUrl: 'https://example.org/' })
  expect(response.status).toBe(200)
  expect((await response.json()).tenant.contact.postalCode).toBe('45.930-000')
  const updated = await db.tenant.findUniqueOrThrow({ where: { id: first.id } })
  const untouched = await db.tenant.findUniqueOrThrow({ where: { id: second.id } })
  expect(updated.contactAddress).toBe('Rua 1')
  expect(updated.settings).toBe('{}')
  expect(untouched.contactAddress).toBeNull()
})
