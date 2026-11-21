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

  const [agenda, attendance, votings, speeches, parliamentarians, agendaRevision, transmission, recording, ata] = await Promise.all([
    session.agendaPublished
      ? db.agendaItem.findMany({ where: { sessionId: session.id }, orderBy: { order: 'asc' } })
      : Promise.resolve([]),
    currentAttendance(db, session.id, tenant.id),
    db.voting.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      include: { impediments: { where: { revokedAt: null }, select: { id: true } } },
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
    db.transmission.findUnique({ where: { sessionId: session.id }, select: { publicUrl: true, publicPublishedAt: true, publicObservationId: true } }),
    db.sessionRecording.findUnique({ where: { sessionId: session.id }, select: { status: true, durationSeconds: true, publishedAt: true, expiresAt: true, replaySha256: true, manifestSha256: true } }),
    db.publication.findFirst({ where: { tenantId: tenant.id, kind: 'ata_sessao', status: 'published', activeAtaSessionKey: session.id },
      select: { id: true, publishedAt: true, publishedContentSha256: true, verificationCode: true } })
      .then((active) => active ?? db.publication.findFirst({ where: { tenantId: tenant.id, kind: 'ata_sessao',
        status: 'published', sessionId: session.id }, orderBy: { publishedAt: 'desc' },
        select: { id: true, publishedAt: true, publishedContentSha256: true, verificationCode: true } })),
  ])

  const partyById = new Map(parliamentarians.map((p) => [p.id, p.party]))
  const closed = session.status === 'closed'

  return Response.json({
    session: {
      id: session.id,
      number: session.number,
      official: session.official,
      year: session.year,
      type: session.type as 'ordinaria' | 'extraordinaria' | 'solene' | 'especial',
      scheduledAt: session.scheduledAt.toISOString(),
      status: session.status as string,
      agendaPublished: session.agendaPublished,
    },
    transmissionLink: transmission?.publicUrl && transmission.publicPublishedAt && (!session.official || transmission.publicObservationId)
      ? { url: transmission.publicUrl, publishedAt: transmission.publicPublishedAt.toISOString() }
      : null,
    localReplay: recording?.status === 'published' && recording.publishedAt && (!recording.expiresAt || recording.expiresAt > new Date())
      ? { durationSeconds: recording.durationSeconds, publishedAt: recording.publishedAt.toISOString(), expiresAt: recording.expiresAt?.toISOString() ?? null,
          replaySha256: recording.replaySha256, manifestSha256: recording.manifestSha256 }
      : null,
    ata: ata ? { publicationId: ata.id, publishedAt: ata.publishedAt?.toISOString() ?? null,
      contentSha256: ata.publishedContentSha256, verificationCode: ata.verificationCode } : null,
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
      .filter((v) => ['closed', 'annulled'].includes(v.status) && v.resultStatus !== null)
      .map((v) => toPublicVotingResult(v, partyById, v.impediments.length)),
    speeches: speeches.map(toPublicSpeech),
    replayMarkers: (() => {
      const originMs = (session.openedAt ?? session.scheduledAt).getTime()
      const offset = (d: Date) => Math.max(0, Math.round((d.getTime() - originMs) / 1000))
      const markers: Array<{
        type: 'session_opened' | 'voting_opened' | 'voting_closed' | 'speech_started'
        label: string
        at: string
        offsetSeconds: number
        refId: string
      }> = []
      if (session.openedAt) {
        markers.push({
          type: 'session_opened',
          label: 'Abertura da sessão',
          at: session.openedAt.toISOString(),
          offsetSeconds: 0,
          refId: session.id,
        })
      }
      for (const v of votings) {
        if (v.openedAt) {
          markers.push({
            type: 'voting_opened',
            label: `Votação aberta: ${v.question.slice(0, 80)}`,
            at: v.openedAt.toISOString(),
            offsetSeconds: offset(v.openedAt),
            refId: v.id,
          })
        }
        if (v.closedAt) {
          markers.push({
            type: 'voting_closed',
            label: `Votação encerrada: ${v.question.slice(0, 80)}`,
            at: v.closedAt.toISOString(),
            offsetSeconds: offset(v.closedAt),
            refId: v.id,
          })
        }
      }
      for (const s of speeches) {
        const speaker = s.parliamentarian?.name ?? s.externalSpeaker ?? 'Orador'
        markers.push({
          type: 'speech_started',
          label: `Pronunciamento: ${speaker}`,
          at: s.createdAt.toISOString(),
          offsetSeconds: offset(s.createdAt),
          refId: s.id,
        })
      }
      return markers.sort((a, b) => a.offsetSeconds - b.offsetSeconds)
    })(),
  })
})
