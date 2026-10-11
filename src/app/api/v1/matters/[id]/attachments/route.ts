/**
 * GET|POST /api/v1/matters/:id/attachments — anexos da matéria (metadados).
 * POST: RBAC matter.write; apenas metadados (name, kind, url opcional, sizeBytes).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { loadMatter } from '@/lib/server/loaders'
import { toMatterAttachmentView, matterLabel } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)
  const attachments = await db.matterAttachment.findMany({
    where: { matterId: matter.id },
    orderBy: { createdAt: 'desc' },
  })
  return Response.json({ attachments: attachments.map(toMatterAttachmentView) })
})

const createSchema = z.object({
  name: z.string().min(3, 'Nome do anexo obrigatório.').max(200),
  kind: z.enum(['texto_integral', 'anexo', 'parecer', 'emenda', 'outro']).optional(),
  url: z.string().max(500).optional(),
  sizeBytes: z.number().int().min(0).max(2_000_000_000).optional(),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())
  const matter = await loadMatter(actor, id)

  const attachment = await withTransaction(async (tx) => {
    const created = await tx.matterAttachment.create({
      data: {
        matterId: matter.id,
        name: body.name.trim(),
        kind: body.kind ?? 'anexo',
        url: body.url?.trim() ?? null,
        sizeBytes: body.sizeBytes ?? 0,
      },
    })
    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.attachment_added',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `${matterLabel(matter)} — anexo "${created.name}" (${created.kind}) registrado.`,
      after: { name: created.name, kind: created.kind, sizeBytes: created.sizeBytes, url: created.url },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json({ attachment: toMatterAttachmentView(attachment) }, { status: 201 })
})
