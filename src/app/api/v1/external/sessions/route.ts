/**
 * GET /api/v1/external/sessions — sessões agendadas/realizadas com pauta
 * publicada do tenant da chave (Fase 23, ADR-024). Bearer `legk_…` (escopo
 * sessions.read) OU delegação `deleg_…` do playground. Rate limit 60 req/min
 * por chave. Mesma view do portal público (PublicSessionSummary) + paginação
 * ?page=1&pageSize=20 (máx 50), envelope { data, page, pageSize, total }.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { toPublicSessionSummary } from '@/lib/server/public-serializers'
import { parseExternalPagination, resolveExternalAuth } from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const authResult = await resolveExternalAuth(req, correlationId, 'sessions.read')
  if (!authResult.ok) return authResult.error
  const { tenantId } = authResult.auth

  const { page, pageSize } = parseExternalPagination(req.nextUrl.searchParams)

  // Agendadas/realizadas COM pauta publicada: exclui rascunhos e sessões cuja
  // pauta ainda não saiu (mesmo critério de publicabilidade do portal).
  const where = { tenantId, status: { not: 'draft' }, agendaPublished: true }
  const [total, rows] = await Promise.all([
    db.session.count({ where }),
    db.session.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return Response.json({ data: rows.map(toPublicSessionSummary), page, pageSize, total })
})
