/**
 * GET /api/v1/external/matters — matérias do tenant da chave (Fase 23, ADR-024).
 * Bearer `legk_…` (escopo matters.read) OU delegação `deleg_…` do playground.
 * Rate limit 60 req/min por chave (429 + Retry-After). Mesmas fields do portal
 * público (MatterPublicView). Paginação ?page=1&pageSize=20 (máx 50), envelope
 * { data, page, pageSize, total }.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { toMatterPublicView } from '@/lib/server/public-serializers'
import { parseExternalPagination, resolveExternalAuth } from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const authResult = await resolveExternalAuth(req, correlationId, 'matters.read')
  if (!authResult.ok) return authResult.error
  const { tenantId } = authResult.auth

  const { page, pageSize } = parseExternalPagination(req.nextUrl.searchParams)

  const where = { tenantId }
  const [total, rows] = await Promise.all([
    db.legislativeMatter.count({ where }),
    db.legislativeMatter.findMany({
      where,
      orderBy: [{ type: 'asc' }, { number: 'desc' }, { year: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return Response.json({ data: rows.map(toMatterPublicView), page, pageSize, total })
})
