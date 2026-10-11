/**
 * POST /api/v1/speeches/:id/transition — cronômetro server-side do discurso.
 * start (fila→falando; um único discurso falando por sessão), pause (acumula
 * elapsed), resume, extend (+segundos), finish (acumula e encerra).
 * timerEvents append-only; auditoria `speech.*`; outbox `speech.state_changed`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSpeech } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toSpeechView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'extend', 'finish']),
  seconds: z.number().int().min(1).max(3600).optional(),
})

const TIMER_LABEL: Record<string, string> = {
  start: 'iniciar',
  pause: 'pausar',
  resume: 'retomar',
  extend: 'estender',
  finish: 'encerrar',
}

const AUDIT_LABEL: Record<string, string> = {
  start: 'started',
  pause: 'paused',
  resume: 'resumed',
  extend: 'extended',
  finish: 'finished',
}

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'speech.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const speech = await loadSpeech(actor, id)
  const session = speech.session
  const now = new Date()

  const invalid = (detail: string) =>
    new DomainError('SPEECH_INVALID_TRANSITION', 409, 'Transição inválida', detail)

  const result = await withTransaction(async (tx) => {
    const data: Record<string, unknown> = {}
    let summary = ''

    if (body.action === 'start') {
      if (speech.status !== 'fila') {
        throw invalid(`Só discursos na fila podem iniciar — status atual: ${speech.status}.`)
      }
      const speaking = await tx.speech.findFirst({
        where: { sessionId: speech.sessionId, status: 'falando' },
      })
      if (speaking && speaking.id !== speech.id) {
        throw invalid('Outro discurso em andamento nesta sessão.')
      }
      data.status = 'falando'
      data.startedAt = now
      summary = 'Discurso iniciado.'
    } else if (body.action === 'pause') {
      if (speech.status !== 'falando') {
        throw invalid(`Só discursos em andamento podem ser pausados — status atual: ${speech.status}.`)
      }
      const delta = speech.startedAt
        ? Math.max(0, Math.round((now.getTime() - new Date(speech.startedAt).getTime()) / 1000))
        : 0
      data.status = 'pausado'
      data.elapsedSeconds = speech.elapsedSeconds + delta
      data.startedAt = null
      data.pausedAt = now
      summary = `Discurso pausado com ${data.elapsedSeconds}s acumulados.`
    } else if (body.action === 'resume') {
      if (speech.status !== 'pausado') {
        throw invalid(`Só discursos pausados podem ser retomados — status atual: ${speech.status}.`)
      }
      const speaking = await tx.speech.findFirst({
        where: { sessionId: speech.sessionId, status: 'falando' },
      })
      if (speaking && speaking.id !== speech.id) {
        throw invalid('Outro discurso em andamento nesta sessão.')
      }
      data.status = 'falando'
      data.startedAt = now
      data.pausedAt = null
      summary = 'Discurso retomado.'
    } else if (body.action === 'extend') {
      if (speech.status === 'encerrado') {
        throw invalid('Discurso já encerrado não pode ser estendido.')
      }
      const seconds = body.seconds ?? 60
      data.plannedSeconds = speech.plannedSeconds + seconds
      summary = `Tempo estendido em ${seconds}s (novo total: ${data.plannedSeconds}s).`
    } else {
      // finish
      if (speech.status !== 'falando' && speech.status !== 'pausado') {
        throw invalid(`Só discursos em andamento ou pausados podem ser encerrados — status atual: ${speech.status}.`)
      }
      let elapsed = speech.elapsedSeconds
      if (speech.status === 'falando' && speech.startedAt) {
        elapsed += Math.max(0, Math.round((now.getTime() - new Date(speech.startedAt).getTime()) / 1000))
      }
      data.status = 'encerrado'
      data.elapsedSeconds = elapsed
      data.startedAt = null
      data.pausedAt = null
      data.finishedAt = now
      summary = `Discurso encerrado com ${elapsed}s.`
    }

    // timerEvents append-only ({acao, em})
    const events = (() => {
      try {
        const parsed = speech.timerEvents ? JSON.parse(speech.timerEvents) : []
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    })()
    events.push({ acao: TIMER_LABEL[body.action], em: now.toISOString() })
    data.timerEvents = JSON.stringify(events)

    const updated = await tx.speech.update({
      where: { id: speech.id },
      data,
      include: { parliamentarian: true },
    })

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: `speech.${AUDIT_LABEL[body.action]}`,
      aggregateType: 'speech',
      aggregateId: speech.id,
      summary: `${toSpeechView(updated).speakerName}: ${summary}`,
      before: { status: speech.status, elapsedSeconds: speech.elapsedSeconds, plannedSeconds: speech.plannedSeconds },
      after: { status: updated.status, elapsedSeconds: updated.elapsedSeconds, plannedSeconds: updated.plannedSeconds },
      correlationId,
      ip: clientIp(req),
    })

    const view = toSpeechView(updated)
    const payload = {
      sessionId: speech.sessionId,
      speechId: speech.id,
      speakerName: view.speakerName,
      subject: view.subject,
      status: view.status,
      elapsedSeconds: view.elapsedSeconds,
      plannedSeconds: view.plannedSeconds,
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'speech.state_changed',
      aggregateId: speech.id,
      sessionId: speech.sessionId,
      aggregateVersion: session.version,
      correlationId,
      internalPayload: payload,
      publicPayload: payload,
    })

    return updated
  })

  return Response.json({ speech: toSpeechView(result) })
})
