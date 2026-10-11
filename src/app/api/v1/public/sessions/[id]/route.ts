/**
 * GET /api/v1/public/sessions/:id — detalhe público da sessão: pauta publicada
 * (se agendaPublished), presença consolidada final (nomes+partidos dos
 * presentes, para sessões encerradas), votações com resultado (nominalDetail
 * apenas se modo != secreto) e discursos encerrados (orador, assunto, duração).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import {
  toPublicAgendaItem,
  toPublicSpeech,
  toPublicVotingResult,
} from '@/lib/server/public-serializers'
import { currentAttendance } from '@/lib/server/domain'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const { id } = await ctx.params
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))

  const session = await db.session.findUnique({ where: { id } })
  if (!session || session.tenantId !== tenant.id || session.status === 'draft') {
    throw notFound('Sessão não encontrada neste tenant.')
  }

  const [agenda, attendance, votings, speeches, parliamentarians, agendaRevision] = await Promise.all([
    session.agendaPublished
      ? db.agendaItem.findMany({ where: { sessionId: session.id }, orderBy: { order: 'asc' } })
      : Promise.resolve([]),
    currentAttendance(db, session.id, tenant.id),
    db.voting.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    }),
    db.speech.findMany({
      where: { sessionId: session.id, status: 'encerrado' },
      orderBy: { createdAt: 'asc' },
      include: { parliamentarian: true },
    }),
    db.parliamentarian.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, party: true },
    }),
    db.sessionAgendaRevision.findFirst({ where: { tenantId: tenant.id, sessionId: session.id }, orderBy: { revision: 'desc' } }),
  ])

  const partyById = new Map(parliamentarians.map((p) => [p.id, p.party]))
  const closed = session.status === 'closed'

  return Response.json({
    session: {
      id: session.id,
      number: session.number,
      year: session.year,
      type: session.type as 'ordinaria' | 'extraordinaria' | 'solene' | 'especial',
      scheduledAt: session.scheduledAt.toISOString(),
      status: session.status as string,
      agendaPublished: session.agendaPublished,
    },
    agenda: agenda.map(toPublicAgendaItem),
    agendaRevision: agendaRevision ? { number: agendaRevision.revision, publishedAt: agendaRevision.createdAt.toISOString(), justification: agendaRevision.justification, noticeSha256: agendaRevision.noticeSha256 } : null,
    // Presença consolidada final: apenas quando a sessão foi encerrada.
    attendance: closed
      ? {
          presentCount: attendance.quorum.present,
          totalMembers: attendance.quorum.total,
          present: attendance.rows
            .filter((r) => r.present)
            .map((r) => ({ name: r.name, party: r.party })),
        }
      : null,
    votings: votings
      .filter((v) => v.status === 'closed' && v.resultStatus !== null)
      .map((v) => toPublicVotingResult(v, partyById)),
    speeches: speeches.map(toPublicSpeech),
  })
})
