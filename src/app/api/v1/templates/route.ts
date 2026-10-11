/**
 * GET|POST /api/v1/templates — modelos de documento do tenant (Fase 14).
 *
 * GET: lista com metadados (kind, name, active, currentVersion, description,
 * createdAt, updatedAt) + `lastVersion` {authorName, changeNote, createdAt} da
 * última versão; ordenada por kind asc, name asc. Leitura para qualquer papel
 * autenticado do tenant.
 *
 * POST (RBAC template.write): cria o template (currentVersion 1) + a versão v1
 * (authorName = ator) numa única transação; auditoria `template.created`
 * (aggregateType 'document_template'). 201.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { DocumentTemplateVersion } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { TEMPLATE_KINDS, toTemplateView } from '@/lib/server/templates'
import { TEMPLATE_KIND_LABEL, type TemplateKind } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)

  const templates = await db.documentTemplate.findMany({
    where: { tenantId },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  })

  // Última versão de cada template (currentVersion) — uma única query.
  const ids = templates.map((t) => t.id)
  const latestVersions = ids.length
    ? await db.documentTemplateVersion.findMany({
        where: { templateId: { in: ids } },
        orderBy: [{ templateId: 'asc' }, { version: 'desc' }],
      })
    : []
  const lastByTemplate = new Map<string, DocumentTemplateVersion>()
  for (const v of latestVersions) {
    if (!lastByTemplate.has(v.templateId)) lastByTemplate.set(v.templateId, v)
  }

  return Response.json({
    templates: templates.map((t) => {
      const last = lastByTemplate.get(t.id) ?? null
      return {
        ...toTemplateView(t),
        lastVersion: last
          ? {
              authorName: last.authorName,
              changeNote: last.changeNote ?? null,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
      }
    }),
  })
})

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Nome deve ter entre 3 e 120 caracteres.')
    .max(120, 'Nome deve ter entre 3 e 120 caracteres.'),
  kind: z.enum(TEMPLATE_KINDS),
  description: z.string().trim().max(300, 'Descrição deve ter no máximo 300 caracteres.').optional(),
  bodyMd: z
    .string()
    .min(1, 'O corpo do modelo é obrigatório (Markdown com placeholders).')
    .max(50000, 'O corpo deve ter no máximo 50000 caracteres.'),
  changeNote: z.string().trim().max(200, 'Nota de mudança deve ter no máximo 200 caracteres.').optional(),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'template.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const body = createSchema.parse(await req.json())

  const template = await withTransaction(async (tx) => {
    const created = await tx.documentTemplate.create({
      data: {
        tenantId,
        name: body.name,
        kind: body.kind,
        description: body.description ?? null,
        active: true,
        currentVersion: 1,
      },
    })
    await tx.documentTemplateVersion.create({
      data: {
        templateId: created.id,
        version: 1,
        bodyMd: body.bodyMd,
        changeNote: body.changeNote ?? null,
        authorName: actor.name,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'template.created',
      aggregateType: 'document_template',
      aggregateId: created.id,
      summary: `Modelo "${created.name}" criado (v1, ${
        TEMPLATE_KIND_LABEL[body.kind as TemplateKind]
      }) — versionamento por tenant.`,
      after: { name: created.name, kind: created.kind, currentVersion: 1, active: true },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json({ template: toTemplateView(template) }, { status: 201 })
})
