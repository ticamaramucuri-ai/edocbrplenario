/**
 * GET /api/v1/public/live?tenant=slug — portal público/telão (SEM autenticação).
 * Sessão ao vivo (check_in|open|suspended|resumed mais recente) OU próxima
 * agendada OU última encerrada. NUNCA expõe dados internos: voto secreto sem
 * nominalDetail (sempre null), registeredCount sempre, hidePartial respeitado
 * pela UI. Rate limit simulado pelo gateway.
 * Fase 18 (Onda 4): `options` (chave/rótulo) em currentVoting/lastResults —
 * rótulos regimentais são PÚBLICOS (o telão exibe as opções da votação em
 * curso e as contagens por rótulo no resultado; ADR-019).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { SESSION_STATUS_LABEL, type PublicLiveView, type SessionStatus, type VotingMode, type VotingStatus, type AgendaItemStatus } from '@/lib/contracts'
import { currentAttendance, tenantSettings } from '@/lib/server/domain'
import { sessionLabel, parseNominalDetail, parseResultCounts } from '@/lib/server/serializers'
import { defaultTenant } from '@/lib/server/default-tenant'
import { parseDisplayState } from '@/lib/display-state'

export const dynamic = 'force-dynamic'

const LIVE_STATUSES = ['check_in', 'open', 'suspended', 'resumed']

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const slug = req.nextUrl.searchParams.get('tenant')
  const tenant = slug
    ? await db.tenant.findUnique({ where: { slug } })
    : await defaultTenant()
  if (!tenant?.active) throw notFound('Tenant não encontrado (use ?tenant=slug).')

  const activeCount = await db.parliamentarian.count({
    where: { tenantId: tenant.id, active: true },
  })
  const settings = tenantSettings(tenant, activeCount)
  const now = new Date()

  // Sessão ao vivo → próxima agendada → última encerrada
  const live = await db.session.findFirst({
    where: { tenantId: tenant.id, status: { in: LIVE_STATUSES } },
    orderBy: { updatedAt: 'desc' },
  })
  const next = live
    ? null
    : await db.session.findFirst({
        where: { tenantId: tenant.id, status: 'scheduled', scheduledAt: { gte: now } },
        orderBy: { scheduledAt: 'asc' },
      })
  const lastClosed = live || next
    ? null
    : await db.session.findFirst({
        where: { tenantId: tenant.id, status: 'closed' },
        orderBy: { closedAt: 'desc' },
      })
  const selected = live ?? next ?? lastClosed

  if (!selected) {
    const empty: PublicLiveView = {
      tenant: {
        name: tenant.name,
        city: tenant.city,
        uf: tenant.uf,
        primaryColor: tenant.primaryColor,
        accentColor: tenant.accentColor,
        logoUrl: tenant.logoUrl,
      },
      session: null,
      transmissionLink: null,
      localReplay: null,
      presentMembers: [],
      agenda: [],
      currentVoting: null,
      lastResults: [],
      speakingNow: null,
      displayState: null,
    }
    return Response.json(empty)
  }

  const isLive = Boolean(live)
  const [agenda, attendance, parliamentarians, currentVotingRaw, closedVotings, speaking, transmission, recording, displayState] =
    await Promise.all([
      selected.agendaPublished
        ? db.agendaItem.findMany({ where: { sessionId: selected.id }, orderBy: { order: 'asc' } })
        : Promise.resolve([]),
      currentAttendance(db, selected.id, tenant.id),
      db.parliamentarian.findMany({
        where: { tenantId: tenant.id, active: true },
        select: { id: true, name: true, party: true, photoUrl: true, partyEmblemUrl: true, order: true },
      }),
      db.voting.findFirst({
        where: { sessionId: selected.id, status: { in: ['open', 'paused', 'closed', 'annulled'] } },
        orderBy: { updatedAt: 'desc' },
        include: { votes: true, options: { orderBy: { order: 'asc' } } },
      }),
      db.voting.findMany({
        where: { sessionId: selected.id, status: { in: ['closed', 'annulled'] }, resultStatus: { not: null } },
        orderBy: { closedAt: 'desc' },
        take: 10,
        include: { options: { orderBy: { order: 'asc' } } },
      }),
      isLive
        ? db.speech.findFirst({
            where: { sessionId: selected.id, status: 'falando' },
            orderBy: { startedAt: 'desc' },
            include: { parliamentarian: true },
          })
        : Promise.resolve(null),
      db.transmission.findUnique({ where: { sessionId: selected.id }, select: { publicUrl: true, publicPublishedAt: true, publicObservationId: true } }),
      db.sessionRecording.findUnique({ where: { sessionId: selected.id }, select: { status: true, durationSeconds: true, publishedAt: true, expiresAt: true } }),
      db.displayState.findUnique({ where: { sessionId: selected.id }, select: { sessionId: true, version: true, mode: true, manualProfile: true } }),
    ])

  const memberById = new Map(parliamentarians.map((p) => [p.id, p]))
  const nominalMember = (id: string) => {
    const member = memberById.get(id)
    return { party: member?.party ?? '', photoUrl: member?.photoUrl ?? null, partyEmblemUrl: member?.partyEmblemUrl ?? null }
  }
  // Fase 18: rótulos das opções customizadas são públicos (telão/portal)
  const publicOptions = (rows: Array<{ key: string; label: string; order: number }>) =>
    rows.map((o) => ({ key: o.key, label: o.label, order: o.order }))
  let currentVoting: PublicLiveView['currentVoting'] = null
  if (currentVotingRaw) {
    const closed = currentVotingRaw.status === 'closed'
    const resolved = closed || currentVotingRaw.status === 'annulled'
    const nominalDetail =
      closed && currentVotingRaw.mode !== 'secreto'
        ? (parseNominalDetail(currentVotingRaw.resultDetail) ?? []).map((d) => ({
            name: d.name,
            ...nominalMember(d.parliamentarianId),
            value: d.value,
          }))
        : null
    currentVoting = {
      id: currentVotingRaw.id,
      question: currentVotingRaw.question,
      mode: currentVotingRaw.mode as VotingMode,
      status: currentVotingRaw.status as VotingStatus,
      registeredCount: currentVotingRaw.votes.length,
      hidePartial: currentVotingRaw.hidePartial,
      resultStatus: resolved ? currentVotingRaw.resultStatus : null,
      resultCounts: closed ? parseResultCounts(currentVotingRaw.resultCounts) : null,
      nominalDetail,
      // Aditivo (Fase 18): rótulos das opções regimentais customizadas
      options: publicOptions(currentVotingRaw.options),
    } as PublicLiveView['currentVoting']
  }

  const view: PublicLiveView = {
    displayState: parseDisplayState(displayState),
    tenant: {
      name: tenant.name,
      city: tenant.city,
      uf: tenant.uf,
      primaryColor: tenant.primaryColor,
      accentColor: tenant.accentColor,
      logoUrl: tenant.logoUrl,
    },
    transmissionLink: transmission?.publicUrl && transmission.publicPublishedAt && (!selected.official || transmission.publicObservationId)
      ? { url: transmission.publicUrl, publishedAt: transmission.publicPublishedAt.toISOString() }
      : null,
    localReplay: recording?.status === 'published' && recording.publishedAt && (!recording.expiresAt || recording.expiresAt > now)
      ? { durationSeconds: recording.durationSeconds, publishedAt: recording.publishedAt.toISOString(), expiresAt: recording.expiresAt?.toISOString() ?? null }
      : null,
    session: {
      id: selected.id,
      label: sessionLabel(selected),
      status: selected.status as SessionStatus,
      statusLabel:
        SESSION_STATUS_LABEL[selected.status as keyof typeof SESSION_STATUS_LABEL] ?? selected.status,
      scheduledAt: selected.scheduledAt.toISOString(),
      presidentName: selected.presidentName ?? null,
      presentCount: attendance.quorum.present,
      totalMembers: attendance.quorum.total,
      requiredQuorum: settings.quorumMinimum,
    },
    agenda: agenda.map((item) => ({
      id: item.id,
      order: item.order,
      section: item.section as 'expediente' | 'ordem_do_dia' | 'comunicacoes',
      title: item.title,
      status: item.status as AgendaItemStatus,
      resultSummary: item.resultSummary ?? null,
    })),
    presentMembers: attendance.rows
      .filter((r) => r.present)
      .map((r) => ({ name: r.name, party: r.party, photoUrl: r.photoUrl, partyEmblemUrl: r.partyEmblemUrl })),
    currentVoting,
    lastResults: closedVotings.map((v) => ({
      id: v.id,
      question: v.question,
      resultStatus: v.resultStatus ?? null,
      resultCounts: parseResultCounts(v.resultCounts),
      closedAt: v.closedAt ? v.closedAt.toISOString() : null,
      nominalDetail:
        v.status === 'closed' && v.mode !== 'secreto'
          ? (parseNominalDetail(v.resultDetail) ?? []).map((d) => ({
              name: d.name,
              ...nominalMember(d.parliamentarianId),
              value: d.value,
            }))
          : null,
      // Aditivo (Fase 18): rótulos das opções regimentais customizadas
      options: publicOptions(v.options),
    })) as PublicLiveView['lastResults'],
    speakingNow: speaking
      ? {
          speakerName: speaking.parliamentarian?.name ?? speaking.externalSpeaker ?? 'Orador',
          photoUrl: speaking.parliamentarian?.photoUrl ?? null,
          party: speaking.parliamentarian?.party ?? null,
          partyEmblemUrl: speaking.parliamentarian?.partyEmblemUrl ?? null,
          subject: speaking.subject ?? null,
          plannedSeconds: speaking.plannedSeconds,
          elapsedSeconds:
            speaking.elapsedSeconds +
            (speaking.startedAt
              ? Math.max(0, Math.round((now.getTime() - new Date(speaking.startedAt).getTime()) / 1000))
              : 0),
          status: 'falando',
        }
      : null,
  }

  return Response.json(view)
})
