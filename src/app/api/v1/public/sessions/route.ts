/**
 * GET /api/v1/public/sessions?year=&status=&limit= — lista pública de sessões
 * (exclui rascunhos não publicados): number, year, type, scheduledAt, status,
 * agendaPublished. Sem autenticação; ?tenant=slug.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toPublicSessionSummary } from '@/lib/server/public-serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))
  const params = req.nextUrl.searchParams

  const yearRaw = params.get('year')?.trim() || null
  const status = params.get('status')?.trim() || null
  const limit = Math.min(Math.max(parseInt(params.get('limit')?.trim() || '50', 10) || 50, 1), 200)
  const year = yearRaw ? parseInt(yearRaw, 10) : null

  const sessions = await db.session.findMany({
    where: {
      tenantId: tenant.id,
      status: { not: 'draft' },
      ...(year !== null && !Number.isNaN(year) ? { year } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { scheduledAt: 'desc' },
    take: limit,
  })

  return Response.json({ sessions: sessions.map(toPublicSessionSummary) })
})
