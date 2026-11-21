import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as getMeContext } from '@/app/api/v1/me/context/route'

afterAll(async () => {
  await db.$disconnect()
})

test('me/context inclui activeMatterAttachments da matéria vinculada à votação/pauta ativa', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `pwa-${suffix}`, name: 'Câmara PWA', city: 'Teste', uf: 'BA' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Ver. PWA', party: 'SEM' } })
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      parliamentarianId: member.id,
      name: 'Ver. PWA',
      email: `pwa-${suffix}@example.invalid`,
      role: 'parliamentarian',
    },
  })
  const matter = await db.legislativeMatter.create({
    data: {
      tenantId: tenant.id,
      type: 'PL',
      number: 10,
      year: 2040,
      ementa: 'Dispõe sobre teste de anexos no PWA.',
      authors: JSON.stringify(['Mesa']),
      status: 'em_pauta',
    },
  })
  await db.matterAttachment.create({
    data: {
      matterId: matter.id,
      name: 'Parecer CCJ.pdf',
      kind: 'parecer',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      content: Buffer.from('%PDF-1.4 mock'),
    },
  })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2040,
      scheduledAt: new Date('2040-03-01T12:00:00.000Z'),
      status: 'open',
      official: true,
    },
  })
  await db.agendaItem.create({
    data: {
      sessionId: session.id,
      matterId: matter.id,
      section: 'ordem_dia',
      order: 0,
      title: 'PL 10/2040',
      status: 'em_discussao',
    },
  })

  const res = await getMeContext(
    new NextRequest('http://localhost/api/v1/me/context', { headers: { 'x-actor-id': user.id } }),
    { params: Promise.resolve({}) }
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.activeMatterAttachments)).toBe(true)
  expect(body.activeMatterAttachments.length).toBe(1)
  expect(body.activeMatterAttachments[0].name).toBe('Parecer CCJ.pdf')
  expect(body.activeMatterAttachments[0].hasFile).toBe(true)
  expect(body.activeMatterAttachments[0].content).toBeUndefined()
})
