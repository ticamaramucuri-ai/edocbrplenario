/**
 * GET /api/v1/public/matters?type=&year=&status=&author=&q=&limit=&cursor=
 * Pesquisa pública de matérias com paginação por cursor (ordem type asc,
 * number desc, year desc). MatterPublicView = id, type, number, year, ementa,
 * authors, status, regime, createdAt. Sem autenticação; ?tenant=slug.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toMatterPublicView } from '@/lib/server/public-serializers'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))
  const params = req.nextUrl.searchParams

  const type = params.get('type')?.trim() || null
  const yearRaw = params.get('year')?.trim() || null
  const status = params.get('status')?.trim() || null
  const author = params.get('author')?.trim() || null
  const q = params.get('q')?.trim() || null
  const limit = Math.min(Math.max(parseInt(params.get('limit')?.trim() || '20', 10) || 20, 1), MAX_LIMIT)
  const cursor = params.get('cursor')?.trim() || null

  const year = yearRaw ? parseInt(yearRaw, 10) : null
  if (yearRaw && year === null) {
    return Response.json({ matters: [], nextCursor: null })
  }

  const where: Prisma.LegislativeMatterWhereInput = {
    tenantId: tenant.id,
    ...(type ? { type } : {}),
    ...(year !== null && !Number.isNaN(year) ? { year } : {}),
    ...(status ? { status } : {}),
    // autores são um JSON array de nomes → contains no texto JSON
    ...(author ? { authors: { contains: author } } : {}),
    ...(q ? { ementa: { contains: q } } : {}),
  }

  const rows = await db.legislativeMatter.findMany({
    where,
    orderBy: [{ type: 'asc' }, { number: 'desc' }, { year: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return Response.json({
    matters: page.map(toMatterPublicView),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
})
