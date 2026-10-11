import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as uploadDocument, GET as listDocuments } from '@/app/api/v1/sessions/[id]/documents/route'
import { GET as downloadDocument } from '@/app/api/v1/sessions/[id]/documents/[documentId]/route'
import { POST as transition } from '@/app/api/v1/sessions/[id]/transition/route'
import { POST as attest, GET as listDeliveries } from '@/app/api/v1/sessions/[id]/notice-deliveries/route'
import { POST as amend } from '@/app/api/v1/sessions/[id]/agenda-amendments/route'

afterAll(async () => { await db.$disconnect() })

test('PDFs versionados entram na convocação; declaração externa é idempotente e depende da revisão vigente', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `prepare-${suffix}`, name: 'Câmara de Teste', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Outro', email: `out-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente', party: 'ABC', boardRole: 'presidente' } })
  const firstMatter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Primeira', authors: '[]' } })
  const secondMatter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 2, year: 2026, ementa: 'Segunda', authors: '[]' } })
  const headers = (actorId: string) => ({ 'x-actor-id': actorId })
  const created = await createSession(new NextRequest('http://localhost/api/v1/sessions', { method: 'POST', headers: { ...headers(admin.id), 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'ordinaria', scheduledAt: '2027-06-01T20:00:00.000Z', presidentId: president.id, location: 'Plenário de teste', matterIds: [firstMatter.id] }),
  }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const session = (await created.json()).session
  const context = { params: Promise.resolve({ id: session.id as string }) }
  const upload = (actorId: string, content: string) => {
    const form = new FormData()
    form.set('kind', 'pauta')
    form.set('file', new File([content], 'pauta.pdf', { type: 'application/pdf' }))
    return uploadDocument(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/documents`, { method: 'POST', headers: headers(actorId), body: form }), context)
  }
  expect((await upload(outsider.id, '%PDF-1.4\n%%EOF')).status).toBe(403)
  expect((await upload(admin.id, 'arquivo falso')).status).toBe(422)
  const first = await upload(admin.id, '%PDF-1.4\nprimeira versao\n%%EOF')
  expect(first.status).toBe(201)
  const doc1 = (await first.json()).document
  expect(doc1.version).toBe(1)
  const second = await upload(admin.id, '%PDF-1.4\nsegunda versao\n%%EOF')
  expect(second.status).toBe(201)
  const doc2 = (await second.json()).document
  expect(doc2.version).toBe(2)
  expect(doc2.sha256).not.toBe(doc1.sha256)
  expect((await listDocuments(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/documents`, { headers: headers(outsider.id) }), context)).status).toBe(403)
  const downloaded = await downloadDocument(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/documents/${doc2.id}`, { headers: headers(admin.id) }), { params: Promise.resolve({ id: session.id, documentId: doc2.id }) })
  expect(downloaded.status).toBe(200)
  expect(await downloaded.text()).toContain('segunda versao')
  const scheduled = await transition(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/transition`, { method: 'POST', headers: { ...headers(admin.id), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'schedule', version: 1 }) }), context)
  expect(scheduled.status).toBe(200)
  expect((await upload(admin.id, '%PDF-1.4\nterceira\n%%EOF')).status).toBe(409)
  const revision = await db.sessionAgendaRevision.findFirstOrThrow({ where: { sessionId: session.id, revision: 1 } })
  const manifest = JSON.parse(revision.documentManifestJson)
  expect(manifest).toHaveLength(1)
  expect(manifest[0].id).toBe(doc2.id)
  expect(JSON.parse(revision.noticeJson!).documents[0].sha256).toBe(doc2.sha256)
  const deliveryBody = { revision: 1, noticeSha256: revision.noticeSha256!, parliamentarianId: president.id, channel: 'presencial',
    evidenceReference: 'Protocolo de teste 1/2027', deliveredAt: new Date().toISOString(), commandId: crypto.randomUUID(), acknowledged: true }
  const send = (body: object) => attest(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/notice-deliveries`, { method: 'POST', headers: { ...headers(admin.id), 'content-type': 'application/json' }, body: JSON.stringify(body) }), context)
  expect((await send({ ...deliveryBody, parliamentarianId: outsider.id })).status).toBe(422)
  const attested = await send(deliveryBody)
  expect(attested.status).toBe(201)
  expect((await attested.json()).mode).toBe('manual_attestation')
  expect((await send(deliveryBody)).status).toBe(200)
  expect(await db.sessionNoticeDelivery.count({ where: { sessionId: session.id } })).toBe(1)
  const amendment = await amend(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/agenda-amendments`, { method: 'POST', headers: { ...headers(admin.id), 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add', mode: 'apply', version: 2, matterId: secondMatter.id, justification: 'Nova matéria para teste' }),
  }), context)
  expect(amendment.status).toBe(201)
  expect((await send({ ...deliveryBody, commandId: crypto.randomUUID() })).status).toBe(409)
  const current = await (await listDeliveries(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/notice-deliveries`, { headers: headers(admin.id) }), context)).json()
  expect(current.revision).toBe(2)
  expect(current.deliveries).toHaveLength(0)
  const history = await (await listDeliveries(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/notice-deliveries?revision=1`, { headers: headers(admin.id) }), context)).json()
  expect(history.deliveries).toHaveLength(1)
})
