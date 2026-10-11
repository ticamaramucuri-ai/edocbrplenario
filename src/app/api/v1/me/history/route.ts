/**
 * GET /api/v1/me/history — histórico pessoal do parlamentar: presenças por
 * sessão (sessions iniciadas: check_in|open|suspended|resumed|closed, último
 * evento de presença derivado, 'ausente' quando sem registro) e votos (valor
 * null em votação secreta — sigilo preservado mesmo para o próprio).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requireMeParliamentarian, attendanceStatusOf } from '@/lib/server/me'
import type { AttendanceStatus, MeHistoryView, VoteValue } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const STARTED_STATUSES = ['check_in', 'open', 'suspended', 'resumed', 'closed']

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const parliamentarian = await requireMeParliamentarian(actor)

  const [sessions, votes] = await Promise.all([
    db.session.findMany({
      where: { tenantId: parliamentarian.tenantId, status: { in: STARTED_STATUSES } },
      orderBy: { scheduledAt: 'desc' },
      take: 30,
    }),
    db.vote.findMany({
      where: { parliamentarianId: parliamentarian.id },
      orderBy: { receivedAt: 'desc' },
      take: 60,
      include: { voting: true },
    }),
  ])

  const sessionIds = sessions.map((s) => s.id)
  const myEvents = sessionIds.length
    ? await db.attendanceEvent.findMany({
        where: { parliamentarianId: parliamentarian.id, sessionId: { in: sessionIds } },
      })
    : []

  const attendance: MeHistoryView['attendance'] = sessions.map((s) => {
    const mine = attendanceStatusOf(
      myEvents
        .filter((e) => e.sessionId === s.id)
        .map((e) => ({ parliamentarianId: e.parliamentarianId, status: e.status, createdAt: e.createdAt })),
      parliamentarian.id
    )
    return {
      sessionId: s.id,
      number: s.number,
      year: s.year,
      date: s.scheduledAt.toISOString(),
      status: mine.status as AttendanceStatus,
    }
  })

  const votesView: MeHistoryView['votes'] = votes.map((v) => ({
    votingId: v.votingId,
    sessionId: v.voting.sessionId,
    question: v.voting.question,
    value: v.voting.mode === 'secreto' ? null : (v.value as VoteValue),
    closedAt: v.voting.closedAt ? v.voting.closedAt.toISOString() : null,
  }))

  return Response.json({ attendance, votes: votesView })
})
