/**
 * GET /api/v1/public/publications/:id — detalhe público do diário eletrônico
 * (Fase 11). Sem autenticação; `?tenant=slug` (default: 1º tenant ativo).
 * Apenas published|revoked (com contentMd, código de verificação e, quando
 * revogada, o motivo). Rascunho ou publicação de outro tenant → 404.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toPublicPublicationDetailView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const { id } = await ctx.params
  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))

  const publication = await db.publication.findUnique({ where: { id } })
  if (
    !publication ||
    publication.tenantId !== tenant.id ||
    (publication.status !== 'published' && publication.status !== 'revoked')
  ) {
    throw notFound('Publicação não encontrada neste tenant.')
  }

  return Response.json({ publication: toPublicPublicationDetailView(publication) })
})
