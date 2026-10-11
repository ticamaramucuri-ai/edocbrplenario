/**
 * GET /api/v1/public/publications — diário eletrônico público (Fase 11).
 * Sem autenticação; `?tenant=slug` (default: 1º tenant ativo).
 * Apenas publicações `published` e `revoked` (revogada entra com selo).
 * Filtros: year (4 dígitos), kind, q (título contains); paginação
 * page/pageSize (max 50). A lista NÃO expõe contentMd nem código de
 * verificação (apenas o detalhe).
 * Resposta: { publications, page, pageSize, total }.
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toPublicPublicationListView } from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

const MAX_PAGE_SIZE = 50
const VISIBLE_STATUSES: string[] = ['published', 'revoked']

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const params = new URL(req.url).searchParams
  const tenant = await resolvePublicTenant(params.get('tenant'))

  const yearRaw = params.get('year')?.trim()
  const kind = params.get('kind')?.trim() || null
  const q = params.get('q')?.trim() || null
  const page = Math.max(1, parseInt(params.get('page')?.trim() || '1', 10) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(params.get('pageSize')?.trim() || '20', 10) || 20)
  )

  let year: number | null = null
  if (yearRaw) {
    year = parseInt(yearRaw, 10)
    if (Number.isNaN(year)) year = null
  }

  const where = {
    tenantId: tenant.id,
    status: { in: VISIBLE_STATUSES },
    ...(year !== null ? { year } : {}),
    ...(kind ? { kind } : {}),
    ...(q ? { title: { contains: q } } : {}),
  }

  const [total, rows] = await Promise.all([
    db.publication.count({ where }),
    db.publication.findMany({
      where,
      orderBy: [{ year: 'desc' }, { number: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return Response.json({
    publications: rows.map(toPublicPublicationListView),
    page,
    pageSize,
    total,
  })
})
