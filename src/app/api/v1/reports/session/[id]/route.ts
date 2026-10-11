/**
 * GET /api/v1/reports/session/:id — espelho completo da sessão (ReportView):
 * tenant + SessionDetail + auditChain (contagem de eventos do agregado da
 * sessão, head da cadeia do tenant e verificação rápida) + verificationCode
 * (head truncado em 12 caracteres, maiúsculo).
 */
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'
import { verifyChain } from '@/lib/server/audit'
import { buildSessionDetail, toTenantView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)

  const [tenant, detail, votingIds, speechIds, parliamentarianCount] = await Promise.all([
    db.tenant.findUnique({ where: { id: session.tenantId } }),
    buildSessionDetail(db, session),
    db.voting.findMany({ where: { sessionId: session.id }, select: { id: true } }),
    db.speech.findMany({ where: { sessionId: session.id }, select: { id: true } }),
    db.parliamentarian.count({ where: { tenantId: session.tenantId, active: true } }),
  ])
  if (!tenant) throw notFound('Câmara não encontrada.')

  const relatedWhere: Prisma.AuditEventWhereInput = {
    tenantId: session.tenantId,
    OR: [
      { aggregateType: 'session', aggregateId: session.id },
      { aggregateType: 'attendance', aggregateId: session.id },
      { aggregateType: 'agenda', aggregateId: session.id },
      { aggregateType: 'voting', aggregateId: { in: votingIds.map((v) => v.id) } },
      { aggregateType: 'vote', aggregateId: { in: votingIds.map((v) => v.id) } },
      { aggregateType: 'speech', aggregateId: { in: speechIds.map((s) => s.id) } },
    ],
  }

  const [eventsCount, chainEvents] = await Promise.all([
    db.auditEvent.count({ where: relatedWhere }),
    db.auditEvent.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ])
  const chain = verifyChain(chainEvents)
  const head = chain.head

  return Response.json({
    tenant: toTenantView(tenant, parliamentarianCount),
    session: detail,
    auditChain: {
      events: eventsCount,
      valid: chain.valid,
      head,
    },
    verificationCode: head ? head.slice(0, 12).toUpperCase() : '—',
  })
})
