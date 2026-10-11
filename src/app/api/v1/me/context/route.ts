/**
 * GET /api/v1/me/context — contexto vivo do App do Parlamentar (PWA):
 * sessão-alvo (em andamento > próxima agendada > última encerrada, igual ao
 * public/live), minha presença, votação aberta + meu voto (valor oculto em
 * votação secreta), minha posição na fila de oradores e regras do tenant.
 * Exige ator parliamentarian com parliamentarianId vinculado (403 claro).
 * Fase 18: activeVoting.voting inclui `options` (rótulos das opções
 * customizadas — aditivo ao contrato; array vazio/ausente = padrão).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requireMeParliamentarian, targetSessionForTenant, attendanceStatusOf } from '@/lib/server/me'
import { currentAttendance, tenantSettings } from '@/lib/server/domain'
import { sessionLabel, toParliamentarianView } from '@/lib/server/serializers'
import type {
  MeActiveVoting,
  MeContextView,
  SessionStatus,
  SessionType,
  VoteValue,
  VotingMode,
  VotingRule,
  VotingStatus,
} from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const parliamentarian = await requireMeParliamentarian(actor)
  const tenantId = parliamentarian.tenantId

  const [tenant, activeCount, session] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId } }),
    db.parliamentarian.count({ where: { tenantId, active: true } }),
    targetSessionForTenant(tenantId),
  ])
  const settings = tenantSettings(tenant ?? { settings: '{}' }, activeCount)

  const view: MeContextView = {
    parliamentarian: toParliamentarianView(parliamentarian),
    session: null,
    attendance: null,
    activeVoting: null,
    speechQueue: { mine: null, position: null, total: 0 },
    tenantSettings: settings,
  }

  if (!session) return Response.json(view)

  const [attendance, events] = await Promise.all([
    currentAttendance(db, session.id, tenantId),
    db.attendanceEvent.findMany({ where: { sessionId: session.id } }),
  ])
  const mine = attendanceStatusOf(
    events.map((e) => ({ parliamentarianId: e.parliamentarianId, status: e.status, createdAt: e.createdAt })),
    parliamentarian.id
  )

  view.session = {
    id: session.id,
    label: sessionLabel(session),
    type: session.type as SessionType,
    number: session.number,
    year: session.year,
    scheduledAt: session.scheduledAt.toISOString(),
    status: session.status as SessionStatus,
    presidentName: session.presidentName ?? null,
    location: session.location,
    quorum: attendance.quorum,
  }
  view.attendance = {
    status: mine.status,
    present: mine.status === 'presente',
    lastEventAt: mine.lastEventAt,
  }

  // Votação aberta (mais recente) — regras de voto idênticas às do operador.
  const openVoting = await db.voting.findFirst({
    where: { sessionId: session.id, status: 'open' },
    orderBy: { updatedAt: 'desc' },
    include: { votes: true, options: { orderBy: { order: 'asc' } } },
  })
  if (openVoting) {
    const secret = openVoting.mode === 'secreto'
    const myVoteRow = openVoting.votes.find((v) => v.parliamentarianId === parliamentarian.id) ?? null
    // Fase 18: `options` é aditivo (MeActiveVoting no contrato permanece válido)
    const votingView: MeActiveVoting & { options?: Array<{ key: string; label: string; order: number }> } = {
      id: openVoting.id,
      sessionId: openVoting.sessionId,
      question: openVoting.question,
      mode: openVoting.mode as VotingMode,
      status: openVoting.status as VotingStatus,
      rule: openVoting.rule as VotingRule,
      hidePartial: openVoting.hidePartial,
      registeredCount: openVoting.votes.length,
      openedAt: openVoting.openedAt ? openVoting.openedAt.toISOString() : null,
      closedAt: openVoting.closedAt ? openVoting.closedAt.toISOString() : null,
      resultStatus: openVoting.resultStatus ?? null,
      options: openVoting.options.map((o) => ({ key: o.key, label: o.label, order: o.order })),
    }
    view.activeVoting = {
      voting: votingView,
      myVote: myVoteRow
        ? {
            value: secret ? null : (myVoteRow.value as VoteValue),
            receivedAt: myVoteRow.receivedAt.toISOString(),
            changedAt: myVoteRow.changedAt ? myVoteRow.changedAt.toISOString() : null,
          }
        : null,
      eligible: mine.status === 'presente',
    }
  }

  // Fila de oradores (status 'fila', ordem de chegada)
  const queue = await db.speech.findMany({
    where: { sessionId: session.id, status: 'fila' },
    orderBy: { createdAt: 'asc' },
  })
  const mineIdx = queue.findIndex((s) => s.parliamentarianId === parliamentarian.id)
  const mineSpeech = mineIdx >= 0 ? queue[mineIdx] : null
  view.speechQueue = {
    mine: mineSpeech
      ? {
          id: mineSpeech.id,
          kind: mineSpeech.kind,
          subject: mineSpeech.subject ?? null,
          status: mineSpeech.status,
          plannedSeconds: mineSpeech.plannedSeconds,
        }
      : null,
    position: mineIdx >= 0 ? mineIdx + 1 : null,
    total: queue.length,
  }

  return Response.json(view)
})
