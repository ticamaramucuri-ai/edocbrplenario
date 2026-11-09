/**
 * GET|POST /api/v1/matters/:id/attachments — anexos da matéria (metadados).
 * POST: RBAC matter.write; PDF privado multipart ou referência legada em JSON.
 */
import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { loadMatter } from '@/lib/server/loaders'
import { toMatterAttachmentView, matterAttachmentMetadata, matterLabel } from '@/lib/server/serializers'
import { MAX_PRIVATE_MATTER_ATTACHMENT_BYTES, validatePrivateMatterPdf } from '@/lib/server/matter-attachment-private'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)
  const attachments = await db.matterAttachment.findMany({
    where: { matterId: matter.id },
    orderBy: { createdAt: 'desc' }, select: matterAttachmentMetadata,
  })
  return Response.json({ attachments: attachments.map(toMatterAttachmentView) })
})

const kindSchema = z.enum(['texto_integral', 'anexo', 'parecer', 'emenda', 'outro'])
const createSchema = z.object({
  name: z.string().min(3, 'Nome do anexo obrigatório.').max(200),
  kind: kindSchema.optional(),
  url: z.string().max(500).optional(),
  sizeBytes: z.number().int().min(0).max(2_000_000_000).optional(),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)
  let body: z.infer<typeof createSchema> & { mimeType?: string; sha256?: string; content?: Uint8Array }
  if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    const declaredLength = Number(req.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PRIVATE_MATTER_ATTACHMENT_BYTES + 1024 * 1024) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Anexo grande demais', 'Use PDF de até 50 MB.')
    }
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.type !== 'application/pdf') {
      throw new DomainError('VALIDATION_ERROR', 422, 'Anexo inválido', 'Envie um arquivo PDF.')
    }
    if (file.size < 8 || file.size > MAX_PRIVATE_MATTER_ATTACHMENT_BYTES) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Anexo inválido', 'Use PDF de até 50 MB.')
    }
    const content = Buffer.from(await file.arrayBuffer())
    try { validatePrivateMatterPdf(content) } catch {
      throw new DomainError('VALIDATION_ERROR', 422, 'Anexo inválido', 'O PDF está incompleto ou fora do limite.')
    }
    const rawName = form.get('name')
    const name = (typeof rawName === 'string' && rawName.trim() ? rawName : file.name)
      .trim().replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200)
    body = createSchema.parse({ name, kind: form.get('kind') || undefined })
    body = { ...body, mimeType: 'application/pdf', sha256: createHash('sha256').update(content).digest('hex'),
      content, sizeBytes: content.byteLength }
  } else {
    body = createSchema.parse(await req.json())
  }

  const attachment = await withTransaction(async (tx) => {
    const created = await tx.matterAttachment.create({
      data: {
        matterId: matter.id,
        name: body.name.trim(),
        kind: body.kind ?? 'anexo',
        url: body.url?.trim() ?? null,
        sizeBytes: body.sizeBytes ?? 0,
        mimeType: body.mimeType ?? null,
        sha256: body.sha256 ?? null,
        content: body.content ? Buffer.from(body.content) : null,
      },
      select: matterAttachmentMetadata,
    })
    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.attachment_added',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `${matterLabel(matter)} — anexo "${created.name}" (${created.kind}) registrado.`,
      after: { name: created.name, kind: created.kind, sizeBytes: created.sizeBytes,
        url: created.url, sha256: created.sha256, privateFile: Boolean(created.sha256) },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json({ attachment: toMatterAttachmentView(attachment) }, { status: 201 })
})
