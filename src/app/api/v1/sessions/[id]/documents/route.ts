import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024
const kinds = new Set(['pauta', 'convocacao', 'apoio'])
const metadata = { id: true, kind: true, version: true, name: true, sizeBytes: true, sha256: true, createdById: true, createdAt: true } as const

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const documents = await db.sessionDocument.findMany({ where: { tenantId: session.tenantId, sessionId: id }, orderBy: [{ kind: 'asc' }, { version: 'desc' }], select: metadata })
  return Response.json({ documents })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.create')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  if (session.status !== 'draft') throw new DomainError('SESSION_INVALID_TRANSITION', 409, 'Sessão publicada', 'Anexos da preparação só podem ser substituídos antes da publicação. Depois disso, registre uma retificação.')
  const form = await req.formData()
  const file = form.get('file')
  const kind = form.get('kind')
  if (!(file instanceof File) || typeof kind !== 'string' || !kinds.has(kind)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Documento inválido', 'Informe o tipo e um arquivo PDF.')
  }
  if (file.size < 8 || file.size > MAX_BYTES || file.type !== 'application/pdf') {
    throw new DomainError('VALIDATION_ERROR', 422, 'Documento inválido', 'Use PDF de até 5 MB.')
  }
  const content = Buffer.from(await file.arrayBuffer())
  if (content.subarray(0, 5).toString('ascii') !== '%PDF-' || !content.includes(Buffer.from('%%EOF'))) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Documento inválido', 'Assinatura PDF inválida.')
  }
  const name = file.name.trim().replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180) || 'documento.pdf'
  const sha256 = createHash('sha256').update(content).digest('hex')
  const document = await withTransaction(async (tx) => {
    const current = await tx.session.findFirst({ where: { id, tenantId: session.tenantId, status: 'draft' } })
    if (!current) throw new DomainError('SESSION_INVALID_TRANSITION', 409, 'Sessão publicada', 'A sessão mudou durante o envio. Recarregue a página.')
    const previous = await tx.sessionDocument.findFirst({ where: { sessionId: id, kind }, orderBy: { version: 'desc' }, select: { version: true } })
    const created = await tx.sessionDocument.create({ data: {
      tenantId: session.tenantId, sessionId: id, kind, version: (previous?.version ?? 0) + 1,
      name, mimeType: 'application/pdf', sizeBytes: content.length, sha256, content, createdById: actor.id,
    }, select: metadata })
    await writeAudit(tx, { tenantId: session.tenantId, actor, action: 'session.document_uploaded', aggregateType: 'session', aggregateId: id,
      summary: `Documento ${kind} v${created.version} anexado ao rascunho.`,
      after: { documentId: created.id, kind, version: created.version, sha256, sizeBytes: created.sizeBytes },
      correlationId, ip: clientIp(req) })
    return created
  })
  return Response.json({ document }, { status: 201 })
})
