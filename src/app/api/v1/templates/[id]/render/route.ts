/**
 * POST /api/v1/templates/:id/render — preview com placeholders resolvidos
 * (Fase 14). Leitura: qualquer papel autenticado do tenant (escopo derivado
 * server-side). NÃO audita (é preview).
 *
 * Corpo OPCIONAL `{sessionId?, matterId?}`: vínculos do contexto de render.
 * Sessão/matéria inexistente OU de outro tenant → 422 com field error.
 * Renderiza SEMPRE a versão atual; tokens desconhecidos permanecem no texto e
 * retornam em `unresolved` (revisão humana — nunca falham o render).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { LegislativeMatter, Session } from '@prisma/client'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { buildTemplateContext, renderTemplate } from '@/lib/server/templates'

export const dynamic = 'force-dynamic'

const renderSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  matterId: z.string().trim().min(1).optional(),
})

function invalidLink(field: 'sessionId' | 'matterId', label: string): DomainError {
  return new DomainError(
    'VALIDATION_ERROR',
    422,
    'Dados inválidos',
    `${label} do contexto não encontrada neste tenant.`,
    { errors: { [field]: [`${label} não encontrada neste tenant.`] } }
  )
}

export const POST = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params

  // Corpo opcional — ausência renderiza apenas com o contexto do tenant.
  const raw = await req.text()
  let payload: unknown = {}
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Corpo da requisição não é um JSON válido.'
      )
    }
  }
  const body = renderSchema.parse(payload)

  const template = await db.documentTemplate.findUnique({ where: { id } })
  if (!template || template.tenantId !== tenantId) {
    throw notFound('Modelo não encontrado neste tenant.')
  }
  const currentBody = await db.documentTemplateVersion.findUnique({
    where: { templateId_version: { templateId: template.id, version: template.currentVersion } },
  })
  if (!currentBody) {
    throw notFound('Versão atual do modelo não encontrada.')
  }

  // Vínculos opcionais: precisam existir e pertencer ao escopo resolvido.
  let session: Session | null = null
  if (body.sessionId) {
    const found = await db.session.findUnique({ where: { id: body.sessionId } })
    if (!found || found.tenantId !== tenantId) throw invalidLink('sessionId', 'Sessão')
    session = found
  }
  let matter: LegislativeMatter | null = null
  if (body.matterId) {
    const found = await db.legislativeMatter.findUnique({ where: { id: body.matterId } })
    if (!found || found.tenantId !== tenantId) throw invalidLink('matterId', 'Matéria')
    matter = found
  }

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw notFound('Tenant não encontrado.')

  const renderCtx = buildTemplateContext(tenant, session, matter)
  const { rendered, unresolved } = renderTemplate(currentBody.bodyMd, renderCtx)

  return Response.json({
    rendered,
    unresolved,
    templateId: template.id,
    version: template.currentVersion,
  })
})
