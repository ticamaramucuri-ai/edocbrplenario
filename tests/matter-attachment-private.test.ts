import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as listAttachments, POST as uploadAttachment } from '@/app/api/v1/matters/[id]/attachments/route'
import { GET as downloadAttachment } from '@/app/api/v1/matters/[id]/attachments/[attachmentId]/file/route'
import { captureMatterSnapshot, freezeMatterSnapshot } from '@/lib/server/session-matter-snapshot'

afterAll(async () => { await db.$disconnect() })

test('PDF privado fica isolado por Câmara, entra no snapshot e bloqueia bytes alterados', async () => {
  const tenant = await db.tenant.create({ data: { slug: 'private-attachment-a', name: 'Câmara A', city: 'A', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: 'private-attachment-b', name: 'Câmara B', city: 'B', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin A', email: 'attachment-a@example.invalid', role: 'tenant_admin' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Admin B', email: 'attachment-b@example.invalid', role: 'tenant_admin' } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id,
    type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Matéria com PDF privado', authors: '[]' } })
  const pdf = Buffer.from('%PDF-1.4\nAnexo privado de ensaio\n%%EOF')
  const url = `http://localhost/api/v1/matters/${matter.id}/attachments`
  const ctx = { params: Promise.resolve({ id: matter.id }) }
  const upload = (actorId: string, bytes: Uint8Array) => {
    const form = new FormData()
    form.set('name', 'Anexo privado.pdf')
    form.set('kind', 'anexo')
    form.set('file', new File([new Uint8Array(bytes)], 'anexo.pdf', { type: 'application/pdf' }))
    return uploadAttachment(new NextRequest(url, { method: 'POST', headers: { 'x-actor-id': actorId }, body: form }), ctx)
  }
  expect((await upload(outsider.id, pdf)).status).toBe(403)
  expect((await upload(admin.id, Buffer.from('arquivo falso'))).status).toBe(422)
  const response = await upload(admin.id, pdf)
  expect(response.status).toBe(201)
  const view = (await response.json()).attachment as { id: string; sha256: string; url: string | null }
  expect(view.url).toBeNull()
  expect(view.sha256).toBe(createHash('sha256').update(pdf).digest('hex'))
  const stored = await db.matterAttachment.findUniqueOrThrow({ where: { id: view.id } })
  expect(Buffer.from(stored.content!)).toEqual(pdf)

  expect((await listAttachments(new NextRequest(url), ctx)).status).toBe(401)
  expect((await listAttachments(new NextRequest(url, { headers: { 'x-actor-id': outsider.id } }), ctx)).status).toBe(403)
  const listed = await listAttachments(new NextRequest(url, { headers: { 'x-actor-id': admin.id } }), ctx)
  expect(listed.status).toBe(200)
  expect(JSON.stringify(await listed.json())).not.toContain('content')

  const fileUrl = `${url}/${view.id}/file`
  const fileCtx = { params: Promise.resolve({ id: matter.id, attachmentId: view.id }) }
  expect((await downloadAttachment(new NextRequest(fileUrl), fileCtx)).status).toBe(401)
  expect((await downloadAttachment(new NextRequest(fileUrl, { headers: { 'x-actor-id': outsider.id } }), fileCtx)).status).toBe(403)
  const downloaded = await downloadAttachment(new NextRequest(fileUrl, { headers: { 'x-actor-id': admin.id } }), fileCtx)
  expect(downloaded.status).toBe(200)
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(pdf)
  expect(downloaded.headers.get('cache-control')).toContain('no-store')

  const snapshot = await db.$transaction((tx) => captureMatterSnapshot(tx, { tenantId: tenant.id,
    agenda: [{ matterId: matter.id }], publicRoot: '/nonexistent-public-root' }))
  expect(snapshot.manifest.unavailableAttachmentIds).toEqual([])
  expect(snapshot.artifacts[0]).toMatchObject({ attachmentId: view.id, mimeType: 'application/pdf',
    sha256: view.sha256, sizeBytes: pdf.length })
  expect(Buffer.from(snapshot.artifacts[0].content)).toEqual(pdf)

  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026,
    scheduledAt: new Date('2026-12-01T12:00:00Z'), status: 'scheduled', agendaPublished: true } })
  const revision = await db.sessionAgendaRevision.create({ data: { tenantId: tenant.id,
    sessionId: session.id, revision: 1, agendaJson: JSON.stringify([{ matterId: matter.id }]), policyJson: '{}' } })
  await db.$transaction((tx) => freezeMatterSnapshot(tx, { revisionId: revision.id, tenantId: tenant.id,
    agenda: [{ matterId: matter.id }], publicRoot: '/nonexistent-public-root' }))

  await db.matterAttachment.update({ where: { id: view.id }, data: { content: Buffer.from('adulterado') } })
  expect((await downloadAttachment(new NextRequest(fileUrl, { headers: { 'x-actor-id': admin.id } }), fileCtx)).status).toBe(409)
  const corrupt = await db.$transaction((tx) => captureMatterSnapshot(tx, { tenantId: tenant.id,
    agenda: [{ matterId: matter.id }], publicRoot: '/nonexistent-public-root' }))
  expect(corrupt.manifest.unavailableAttachmentIds).toEqual([view.id])
  expect(corrupt.artifacts).toHaveLength(0)
  const frozen = await db.sessionMatterArtifact.findFirstOrThrow({ where: { revisionId: revision.id,
    attachmentId: view.id } })
  expect(Buffer.from(frozen.content)).toEqual(pdf)
})
