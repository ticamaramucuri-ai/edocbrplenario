import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createPublication } from '@/app/api/v1/publications/route'
import { GET as getPublication, PATCH as patchPublication } from '@/app/api/v1/publications/[id]/route'

afterAll(async () => {
  await db.$disconnect()
})

const post = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

const patch = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

test('retificação revoga ata publicada, cria rascunho vinculado e permite revisão/publicação independente', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `rect-${suffix}`, name: 'Câmara Retificação', city: 'Teste', uf: 'BA' } })
  const otherTenant = await db.tenant.create({ data: { slug: `rect-other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const reviewer = await db.user.create({
    data: { tenantId: tenant.id, name: 'Revisor', email: `rev-${suffix}@example.invalid`, role: 'legislative_admin' },
  })
  const publisher = await db.user.create({
    data: { tenantId: tenant.id, name: 'Publicador', email: `pub-${suffix}@example.invalid`, role: 'tenant_admin' },
  })
  const foreignUser = await db.user.create({
    data: { tenantId: otherTenant.id, name: 'Externo', email: `ext-${suffix}@example.invalid`, role: 'tenant_admin' },
  })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2039,
      scheduledAt: new Date('2039-02-01T12:00:00.000Z'),
      status: 'closed',
      official: true,
      closedAt: new Date('2039-02-01T15:00:00.000Z'),
    },
  })

  const pubUrl = 'http://localhost/api/v1/publications'
  const createRes = await createPublication(
    post(pubUrl, publisher.id, {
      kind: 'ata_sessao',
      title: 'Ata da 1ª Sessão Ordinária',
      contentMd: 'Texto original da ata da sessão ordinária.',
      sessionId: session.id,
    }),
    { params: Promise.resolve({}) }
  )
  expect(createRes.status).toBe(201)
  const originalId = (await createRes.json()).publication.id as string
  const originalUrl = `${pubUrl}/${originalId}`

  // Rascunho não pode ser retificado diretamente
  const draftRectRes = await patchPublication(
    patch(originalUrl, publisher.id, { action: 'rectify', reason: 'Tentativa em rascunho inválida' }),
    ctx(originalId)
  )
  expect(draftRectRes.status).toBe(409)

  // Revisa e publica a ata original
  const detail1 = await (await getPublication(new NextRequest(originalUrl, { headers: { 'x-actor-id': reviewer.id } }), ctx(originalId))).json()
  expect((await patchPublication(patch(originalUrl, reviewer.id, { action: 'review', expectedHash: detail1.publication.currentReviewHash, reference: 'Conf 01' }), ctx(originalId))).status).toBe(200)
  expect((await patchPublication(patch(originalUrl, publisher.id, { action: 'publish' }), ctx(originalId))).status).toBe(200)

  // Isolamento entre tenants
  const foreignRectRes = await patchPublication(
    patch(originalUrl, foreignUser.id, { action: 'rectify', reason: 'Tentativa cruzada de outro tenant' }),
    ctx(originalId)
  )
  expect(foreignRectRes.status).toBe(404)

  // Motivo curto é rejeitado
  const shortReasonRes = await patchPublication(
    patch(originalUrl, publisher.id, { action: 'rectify', reason: 'curto' }),
    ctx(originalId)
  )
  expect(shortReasonRes.status).toBe(422)

  // Retificação válida revoga a original e cria novo rascunho vinculado
  const rectifyRes = await patchPublication(
    patch(originalUrl, publisher.id, {
      action: 'rectify',
      reason: 'Correção de erro material na redação da ordem do dia.',
    }),
    ctx(originalId)
  )
  expect(rectifyRes.status).toBe(200)
  const rectifyBody = await rectifyRes.json()
  expect(rectifyBody.publication.status).toBe('revoked')
  expect(rectifyBody.publication.revokedReason).toBe('Correção de erro material na redação da ordem do dia.')
  expect(rectifyBody.rectifiedPublication.status).toBe('draft')
  expect(rectifyBody.rectifiedPublication.rectifiesPublicationId).toBe(originalId)

  const rectifiedId = rectifyBody.rectifiedPublication.id as string
  const rectifiedUrl = `${pubUrl}/${rectifiedId}`

  // Edita o texto da retificação, revisa por um papel e publica por outro
  expect(
    (await patchPublication(patch(rectifiedUrl, publisher.id, { action: 'edit', contentMd: 'Texto retificado e conferido da sessão.' }), ctx(rectifiedId))).status
  ).toBe(200)
  const detail2 = await (await getPublication(new NextRequest(rectifiedUrl, { headers: { 'x-actor-id': reviewer.id } }), ctx(rectifiedId))).json()
  expect(
    (await patchPublication(patch(rectifiedUrl, reviewer.id, { action: 'review', expectedHash: detail2.publication.currentReviewHash, reference: 'Conf Retificação' }), ctx(rectifiedId))).status
  ).toBe(200)
  const publishRectRes = await patchPublication(patch(rectifiedUrl, publisher.id, { action: 'publish' }), ctx(rectifiedId))
  expect(publishRectRes.status).toBe(200)
  const publishedRect = await publishRectRes.json()
  expect(publishedRect.publication.status).toBe('published')
  expect(publishedRect.publication.rectifiesPublicationId).toBe(originalId)

  // Confirma que a auditoria registrou a retificação
  const auditRect = await db.auditEvent.findFirst({
    where: { tenantId: tenant.id, aggregateId: rectifiedId, action: 'publication.rectified' },
  })
  expect(auditRect).not.toBeNull()
})
