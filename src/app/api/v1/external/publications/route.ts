/**
 * GET /api/v1/external/publications — publicações do diário eletrônico do
 * tenant da chave, SOMENTE status published (Fase 23, ADR-024). Bearer
 * `legk_…` (escopo publications.read) OU delegação `deleg_…` do playground.
 * Rate limit 60 req/min por chave. View pública de LISTA (sem contentMd nem
 * código de verificação) + paginação ?page=1&pageSize=20 (máx 50), envelope
 * { data, page, pageSize, total }.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { toPublicPublicationListView } from '@/lib/server/publications'
import { parseExternalPagination, resolveExternalAuth } from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const authResult = await resolveExternalAuth(req, correlationId, 'publications.read')
  if (!authResult.ok) return authResult.error
  const { tenantId } = authResult.auth

  const { page, pageSize } = parseExternalPagination(req.nextUrl.searchParams)

  const where = { tenantId, status: 'published' }
  const [total, rows] = await Promise.all([
    db.publication.count({ where }),
    db.publication.findMany({
      where,
      orderBy: [{ year: 'desc' }, { number: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return Response.json({ data: rows.map(toPublicPublicationListView), page, pageSize, total })
})
