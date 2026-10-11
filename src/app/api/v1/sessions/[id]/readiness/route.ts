/** Diagnóstico de prontidão por sessão. Somente leitura e escopo da Câmara. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { currentAttendance } from '@/lib/server/domain'
import { probeMediaSource } from '@/lib/server/media-status'
import { destinationSnapshot, loadMediaDestinations, recordingSnapshot } from '@/lib/server/media-control'
import type { SessionReadinessView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.read')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const path = `session-${id}`
  const [agendaCount, revision, president, attendance, source, configuredDestinations] = await Promise.all([
    db.agendaItem.count({ where: { sessionId: id } }),
    db.sessionAgendaRevision.findFirst({ where: { tenantId: session.tenantId, sessionId: id }, select: { id: true } }),
    session.presidentId ? db.parliamentarian.findFirst({ where: { id: session.presidentId, tenantId: session.tenantId, active: true }, select: { id: true } }) : Promise.resolve(null),
    currentAttendance(db, id, session.tenantId),
    probeMediaSource(id),
    loadMediaDestinations(session.tenantId).catch(() => null),
  ])
  const [recording, destinations] = await Promise.all([
    recordingSnapshot(path).catch(() => null),
    configuredDestinations?.length ? destinationSnapshot(session.tenantId, path).catch(() => null) : Promise.resolve(null),
  ])
  const checks: SessionReadinessView['checks'] = []
  const add = (id: SessionReadinessView['checks'][number]['id'], area: 'legislative' | 'media', state: 'ok' | 'attention' | 'blocked', message: string, action: string | null) => {
    checks.push({ id, area, state, message, action })
  }

  add('agenda', 'legislative', agendaCount > 0 && session.agendaPublished ? 'ok' : 'blocked',
    agendaCount > 0 && session.agendaPublished ? 'Pauta publicada.' : 'Pauta não publicada.',
    agendaCount > 0 && session.agendaPublished ? null : 'Revise a pauta e publique a sessão.')
  add('notice', 'legislative', revision ? 'ok' : 'blocked',
    revision ? 'Convocação registrada.' : session.agendaPublished ? 'Convocação ausente em sessão já publicada.' : 'Convocação não encontrada.',
    revision ? null : session.agendaPublished ?
      'Solicite regularização da sessão legada antes de tratá-la como convocada.' :
      'Publique a pauta para gerar a convocação verificável.')
  add('president', 'legislative', president ? 'ok' : 'blocked',
    president ? 'Presidência ativa vinculada.' : 'Presidência ausente ou inativa.',
    president ? null : 'Indique uma presidência ativa desta Câmara.')
  const quorumObservable = ['check_in', 'open', 'suspended', 'resumed'].includes(session.status)
  add('quorum', 'legislative', !quorumObservable ? 'attention' : attendance.quorum.ok ? 'ok' : 'blocked',
    !quorumObservable ? 'Quórum será conferido após abrir o credenciamento.' :
      `Quórum: ${attendance.quorum.present}/${attendance.quorum.required} presente(s).`,
    !quorumObservable || attendance.quorum.ok ? null : 'Registre ou confira a presença antes de abrir a sessão.')

  add('source', 'media', source.ready ? 'ok' : 'blocked',
    source.ready ? 'Fonte local recebendo sinal.' : source.configured ? 'Fonte local sem sinal.' : 'Métricas da fonte não configuradas.',
    source.ready ? null : 'Confira encoder, rede local e MediaMTX.')
  add('recording', 'media', recording?.configured ? 'ok' : 'blocked',
    recording?.configured ? `Gravação configurada; ${recording.segmentCount} segmento(s) catalogado(s).` : 'Gravação local não confirmada.',
    recording?.configured ? null : 'Confira a configuração de gravação e a API local do MediaMTX.')
  const forwarding = destinations?.destinations.filter((item) => item.enabled && item.state === 'forwarding').length ?? 0
  const destinationState = configuredDestinations === null ? 'blocked' : configuredDestinations.length === 0 ? 'attention' : forwarding > 0 ? 'ok' : 'blocked'
  add('destinations', 'media', destinationState,
    configuredDestinations === null ? 'Arquivo de destinos indisponível.' : configuredDestinations.length === 0 ?
      'Nenhum destino configurado para esta Câmara.' : `${forwarding}/${configuredDestinations.length} destino(s) RTMPS encaminhando.`,
    destinationState === 'ok' ? null : 'Confira o destino e sua reconciliação no painel de transmissão.')

  const view: SessionReadinessView = {
    checkedAt: new Date().toISOString(), sessionId: id,
    sessionReady: checks.filter((check) => check.area === 'legislative').every((check) => check.state !== 'blocked'),
    broadcastReady: checks.filter((check) => check.area === 'media').every((check) => check.state === 'ok'),
    checks,
  }
  return Response.json(view, { headers: { 'Cache-Control': 'no-store' } })
})
