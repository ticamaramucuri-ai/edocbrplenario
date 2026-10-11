/** Convocação pública congelada por revisão, com SHA-256 para conferência do conteúdo. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound, DomainError } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))
  const { id } = await ctx.params
  const session = await db.session.findFirst({ where: { id, tenantId: tenant.id, status: { not: 'draft' } } })
  if (!session) throw notFound('Sessão não encontrada nesta Câmara.')
  const requested = req.nextUrl.searchParams.get('revision')
  const revisionNumber = requested === null ? null : Number(requested)
  if (requested !== null && (!Number.isInteger(revisionNumber) || revisionNumber! < 1)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Revisão inválida', 'Informe um número positivo de revisão.')
  }
  const revision = await db.sessionAgendaRevision.findFirst({
    where: { tenantId: tenant.id, sessionId: id, ...(revisionNumber !== null && { revision: revisionNumber }) },
    orderBy: { revision: 'desc' },
  })
  if (!revision?.noticeJson || !revision.noticeSha256) throw notFound('Convocação não disponível para esta revisão.')
  return Response.json({
    revision: revision.revision,
    publishedAt: revision.createdAt.toISOString(),
    sha256: revision.noticeSha256,
    notice: JSON.parse(revision.noticeJson),
  })
})
