/**
 * POST /api/v1/me/check-in — self check-in pelo App do Parlamentar (source
 * 'pwa'). Regras: sessão-alvo em check_in|open|suspended|resumed (senão 409
 * SESSION_INVALID_TRANSITION), tenantSettings.allowSelfCheckIn !== false
 * (senão 409 SESSION_PRECONDITION). Lógica de presença reaproveitada dos
 * helpers de domínio (append-only + quórum + auditoria + outbox), espelhando
 * a rota do operador (attendance.write).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireMeParliamentarian, targetSessionForTenant } from '@/lib/server/me'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { currentAttendance, tenantSettings } from '@/lib/server/domain'
import { ATTENDANCE_STATUS_LABEL, SESSION_STATUS_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  note: z.string().max(500).optional(),
  commandId: z.string().uuid().optional(),
  sessionId: z.string().min(1).optional(),
})

const LIVE_STATUSES = ['check_in', 'open', 'suspended', 'resumed']

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'self.attendance')
  const parliamentarian = await requireMeParliamentarian(actor)
  const body = bodySchema.parse(await req.json().catch(() => ({})))

  const session = await targetSessionForTenant(parliamentarian.tenantId)
  if (!session) {
    throw new DomainError(
      'SESSION_INVALID_TRANSITION',
      409,
      'Nenhuma sessão disponível',
      'Não há sessão agendada, em andamento ou encerrada recentemente para registrar presença.'
    )
  }
  if (body.sessionId && body.sessionId !== session.id) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Sessão alterada',
      'A sessão em andamento mudou. Atualize a página antes de registrar presença.')
  }
  if (session.official && !body.commandId) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Chave obrigatória', 'Informe commandId para registrar presença em sessão oficial.')
  }
  if (!LIVE_STATUSES.includes(session.status)) {
    throw new DomainError(
      'SESSION_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `O auto check-in exige sessão em credenciamento/aberta/suspensa/retomada — status atual da sessão-alvo: ${SESSION_STATUS_LABEL[session.status as keyof typeof SESSION_STATUS_LABEL] ?? session.status}.`
    )
  }

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId } })
  const activeCount = await db.parliamentarian.count({ where: { tenantId: session.tenantId, active: true } })
  const settings = tenantSettings(tenant ?? { settings: '{}' }, activeCount)
  if (settings.allowSelfCheckIn === false) {
    throw new DomainError(
      'SESSION_PRECONDITION',
      409,
      'Auto check-in desabilitado',
      'O administrador da Câmara desabilitou o auto check-in pelo app (tenant.settings.allowSelfCheckIn=false). Procure a secretaria para registrar presença.'
    )
  }

  const result = await withTransaction(async (tx) => {
    if (body.commandId) {
      const prior = await tx.attendanceEvent.findUnique({ where: { sessionId_commandId: { sessionId: session.id, commandId: body.commandId } } })
      if (prior) {
        if (prior.parliamentarianId !== parliamentarian.id || prior.kind !== 'check_in' || prior.status !== 'presente' ||
            prior.source !== 'pwa' || prior.actorId !== actor.id || prior.note !== (body.note ?? null)) {
          throw new DomainError('CONFLICT_VERSION', 409, 'Comando reutilizado', 'A chave já pertence a outro registro de presença.')
        }
        return { event: prior, quorum: (await currentAttendance(tx, session.id, session.tenantId)).quorum, replay: true }
      }
    }
    const currentSession = await tx.session.findUniqueOrThrow({ where: { id: session.id } })
    if (!LIVE_STATUSES.includes(currentSession.status)) {
      throw new DomainError('SESSION_INVALID_TRANSITION', 409, 'Sessão indisponível', 'A sessão mudou de estado. Atualize antes de registrar presença.')
    }
    const openVoting = await tx.voting.findFirst({ where: { sessionId: session.id, status: { in: ['open', 'paused'] } },
      orderBy: { openedAt: 'desc' }, select: { eligibleVoterIdsAtOpen: true } })
    const frozenIds = openVoting?.eligibleVoterIdsAtOpen ? JSON.parse(openVoting.eligibleVoterIdsAtOpen) as string[] : null
    const eligible = await currentAttendance(tx, session.id, session.tenantId, frozenIds)
    if (!eligible.statuses.has(parliamentarian.id)) {
      throw new DomainError('SESSION_PRECONDITION', 409, 'Fora da base deliberativa',
        'Seu mandato ou suplência não integra a base deliberativa desta sessão. Procure a secretaria.')
    }
    const last = await tx.attendanceEvent.findFirst({
      where: { sessionId: session.id, parliamentarianId: parliamentarian.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })

    const event = await tx.attendanceEvent.create({
      data: {
        sessionId: session.id,
        commandId: body.commandId ?? null,
        parliamentarianId: parliamentarian.id,
        kind: 'check_in',
        status: 'presente',
        source: 'pwa',
        actorId: actor.id,
        note: body.note ?? null,
      },
    })

    const { quorum } = await currentAttendance(tx, session.id, session.tenantId)

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'attendance.changed',
      aggregateType: 'attendance',
      aggregateId: session.id,
      summary: `Auto check-in (PWA) de ${parliamentarian.name}: Presente (quórum ${quorum.present}/${quorum.required}).`,
      before: last ? { status: last.status } : null,
      after: { status: 'presente', source: 'pwa' },
      justification: body.note ?? null,
      correlationId,
      ip: clientIp(req),
    })

    const attendancePayload = {
      sessionId: session.id,
      parliamentarianId: parliamentarian.id,
      name: parliamentarian.name,
      party: parliamentarian.party,
      status: 'presente',
      present: true,
      presentCount: quorum.present,
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'attendance.changed',
      aggregateId: parliamentarian.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
      origin: 'pwa',
      internalPayload: attendancePayload,
      publicPayload: attendancePayload,
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'session.quorum',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
      origin: 'pwa',
      internalPayload: {
        sessionId: session.id,
        present: quorum.present,
        total: quorum.total,
        required: quorum.required,
        ok: quorum.ok,
      },
      publicPayload: {
        sessionId: session.id,
        present: quorum.present,
        total: quorum.total,
        required: quorum.required,
        ok: quorum.ok,
      },
    })

    return { event, quorum, replay: false }
  })

  return Response.json({
    attendance: {
      status: 'presente',
      present: true,
      lastEventAt: result.event.createdAt.toISOString(),
    },
    quorum: result.quorum,
    replay: result.replay,
    message: `Presença registrada por ${ATTENDANCE_STATUS_LABEL.presente.toLowerCase()} via app.`,
  })
})
