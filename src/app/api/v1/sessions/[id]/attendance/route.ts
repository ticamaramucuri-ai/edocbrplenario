/**
 * POST /api/v1/sessions/:id/attendance — presença append-only.
 * Actions: check_in, check_out (saída temporária), return, mark_licenca,
 * mark_afastado, mark_ausente, mark_presente (atalho = check_in direto).
 * Emite `attendance.changed` + `session.quorum`; auditoria `attendance.changed`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession, loadParliamentarian } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { assertNoActiveLocalAuthority } from '@/lib/server/session-authority-lease'
import { emitOutbox } from '@/lib/server/outbox'
import { currentAttendance } from '@/lib/server/domain'
import { SESSION_STATUS_LABEL, ATTENDANCE_STATUS_LABEL } from '@/lib/contracts'
import type { AttendanceStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const ACTIONS: Record<string, { kind: string; status: AttendanceStatus; liveOnly: boolean }> = {
  check_in: { kind: 'check_in', status: 'presente', liveOnly: true },
  check_out: { kind: 'check_out', status: 'saida_temporaria', liveOnly: true },
  return: { kind: 'return', status: 'presente', liveOnly: true },
  mark_licenca: { kind: 'mark', status: 'licenciado', liveOnly: false },
  mark_afastado: { kind: 'mark', status: 'afastado', liveOnly: false },
  mark_ausente: { kind: 'mark', status: 'ausente', liveOnly: false },
  mark_presente: { kind: 'check_in', status: 'presente', liveOnly: false },
}

const bodySchema = z.object({
  parliamentarianId: z.string().min(1, 'Informe o parlamentar.'),
  action: z.enum(['check_in', 'check_out', 'return', 'mark_licenca', 'mark_afastado', 'mark_ausente', 'mark_presente']),
  note: z.string().max(500).optional(),
  source: z.literal('operador').optional(),
  commandId: z.string().uuid().optional(),
})

const LIVE_STATUSES = ['check_in', 'open', 'suspended', 'resumed']
const MARK_STATUSES = ['scheduled', 'check_in']

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'attendance.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, id)
  const parliamentarian = await loadParliamentarian(actor, body.parliamentarianId)
  if (parliamentarian.tenantId !== session.tenantId) {
    throw new DomainError('FORBIDDEN_TENANT', 403, 'Câmara divergente', 'O parlamentar não pertence à Câmara da sessão.')
  }
  if (session.official && !body.commandId) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Chave obrigatória', 'Informe commandId para registrar presença em sessão oficial.')
  }
  const spec = ACTIONS[body.action]

  const result = await withTransaction(async (tx) => {
    if (body.commandId) {
      const prior = await tx.attendanceEvent.findUnique({ where: { sessionId_commandId: { sessionId: session.id, commandId: body.commandId } } })
      if (prior) {
        if (prior.parliamentarianId !== parliamentarian.id || prior.kind !== spec.kind || prior.status !== spec.status ||
            prior.source !== 'operador' || prior.actorId !== actor.id || prior.note !== (body.note ?? null)) {
          throw new DomainError('CONFLICT_VERSION', 409, 'Comando reutilizado', 'A chave já pertence a outro registro de presença.')
        }
        return { event: prior, quorum: (await currentAttendance(tx, session.id, session.tenantId)).quorum, replay: true }
      }
    }
    const currentSession = await tx.session.findUniqueOrThrow({ where: { id: session.id } })
    await assertNoActiveLocalAuthority(tx, session.id)
    const statusLabel = SESSION_STATUS_LABEL[currentSession.status as keyof typeof SESSION_STATUS_LABEL] ?? currentSession.status
    if (spec.liveOnly && !LIVE_STATUSES.includes(currentSession.status)) {
      throw new DomainError('SESSION_INVALID_TRANSITION', 409, 'Transição inválida',
        `Presença (${body.action}) exige sessão em credenciamento/aberta/suspensa/retomada — status atual: ${statusLabel}.`)
    }
    if (!spec.liveOnly && !MARK_STATUSES.includes(currentSession.status)) {
      throw new DomainError('SESSION_INVALID_TRANSITION', 409, 'Transição inválida',
        `Marcação manual (${body.action}) só é permitida em sessão agendada ou em credenciamento — status atual: ${statusLabel}.`)
    }
    const openVoting = await tx.voting.findFirst({ where: { sessionId: session.id, status: { in: ['open', 'paused'] } },
      orderBy: { openedAt: 'desc' }, select: { eligibleVoterIdsAtOpen: true } })
    const frozenIds = openVoting?.eligibleVoterIdsAtOpen ? JSON.parse(openVoting.eligibleVoterIdsAtOpen) as string[] : null
    const eligible = await currentAttendance(tx, session.id, session.tenantId, frozenIds)
    if (!eligible.statuses.has(parliamentarian.id)) {
      throw new DomainError('SESSION_PRECONDITION', 409, 'Fora da base deliberativa',
        'Este parlamentar não integra a base deliberativa da sessão segundo os mandatos e afastamentos cadastrados.')
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
        kind: spec.kind,
        status: spec.status,
        source: body.source ?? 'operador',
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
      summary: `Presença de ${parliamentarian.name}: ${ATTENDANCE_STATUS_LABEL[spec.status]} (quórum ${quorum.present}/${quorum.required}).`,
      before: last ? { status: last.status } : null,
      after: { status: spec.status, source: event.source },
      justification: body.note ?? null,
      correlationId,
      ip: clientIp(req),
    })

    const attendancePayload = {
      sessionId: session.id,
      parliamentarianId: parliamentarian.id,
      name: parliamentarian.name,
      party: parliamentarian.party,
      status: spec.status,
      present: spec.status === 'presente',
      presentCount: quorum.present,
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'attendance.changed',
      aggregateId: parliamentarian.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
      internalPayload: attendancePayload,
      publicPayload: attendancePayload, // nome/público ok no payload público
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'session.quorum',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
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
      parliamentarianId: parliamentarian.id,
      name: parliamentarian.name,
      party: parliamentarian.party,
      bloc: parliamentarian.bloc ?? null,
      boardRole: parliamentarian.boardRole,
      photoUrl: parliamentarian.photoUrl ?? null,
      partyEmblemUrl: parliamentarian.partyEmblemUrl ?? null,
      status: result.event.status,
      present: result.event.status === 'presente',
      lastEventAt: result.event.createdAt.toISOString(),
    },
    quorum: result.quorum,
    replay: result.replay,
  })
})
