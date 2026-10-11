/**
 * POST /api/v1/sessions/:id/transition — máquina de estados da sessão
 * (ADR-002 §1): version otimista, pré-condições, timestamps, auditoria
 * `session.<action>` e outbox `session.state_changed` + `session.quorum`.
 */
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { notify } from '@/lib/server/notify'
import { SESSION_TRANSITIONS, currentAttendance, enforceNoticeDeadline, tenantSettings, type SessionAction } from '@/lib/server/domain'
import { buildSessionSummaries, sessionLabel } from '@/lib/server/serializers'
import { SESSION_STATUS_LABEL } from '@/lib/contracts'
import { createSessionNotice } from '@/lib/server/session-notice'
import { snapshotNoticeRecipients } from '@/lib/server/session-notice-recipients'
import { inspectOfficialConfiguration } from '@/lib/server/official-configuration'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    action: z.enum(['schedule', 'open_checkin', 'open_session', 'suspend', 'resume', 'close', 'cancel']),
    version: z.number({ message: 'version é obrigatório (controle otimista).' }).int().min(1),
    justification: z.string().min(3).max(2000).optional(),
    noticeExceptionReason: z.string().trim().min(3).max(2000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action === 'cancel' && !body.justification) {
      ctx.addIssue({
        code: 'custom',
        path: ['justification'],
        message: 'Justificativa é obrigatória para cancelar a sessão.',
      })
    }
    if (body.action !== 'schedule' && body.noticeExceptionReason) {
      ctx.addIssue({ code: 'custom', path: ['noticeExceptionReason'], message: 'Exceção de prazo só se aplica à publicação da pauta.' })
    }
  })

const SUMMARY: Record<SessionAction, string> = {
  schedule: 'Pauta publicada e sessão agendada.',
  open_checkin: 'Credenciamento aberto para verificação de presença.',
  open_session: 'Sessão aberta.',
  suspend: 'Sessão suspensa temporariamente.',
  resume: 'Sessão retomada.',
  close: 'Sessão encerrada.',
  cancel: 'Sessão cancelada.',
}

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, id)
  if (body.version !== session.version) {
    throw new DomainError(
      'CONFLICT_VERSION',
      409,
      'Conflito de versão',
      `Versão informada (${body.version}) difere da atual (${session.version}). Recarregue a sessão.`
    )
  }

  const transition = SESSION_TRANSITIONS[body.action]
  const from = session.status
  if (!transition.from.includes(from as (typeof transition.from)[number])) {
    throw new DomainError(
      'SESSION_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Ação "${body.action}" não é permitida a partir do status "${SESSION_STATUS_LABEL[from as keyof typeof SESSION_STATUS_LABEL] ?? from}" (permitido: ${transition.from.join(', ')}).`
    )
  }

  const result = await withTransaction(async (tx) => {
    const now = new Date()
    if (body.action === 'suspend' || body.action === 'close') {
      const blockingStatuses = body.action === 'suspend' ? ['open'] : ['ready', 'open', 'paused']
      const pendingVoting = await tx.voting.findFirst({ where: { sessionId: session.id,
        status: { in: blockingStatuses } }, select: { id: true, status: true } })
      if (pendingVoting) throw new DomainError('SESSION_PRECONDITION', 409, 'Votação pendente',
        body.action === 'suspend'
          ? 'Pause a votação aberta antes de suspender a sessão.'
          : 'Conclua ou cancele a votação pendente antes de encerrar a sessão.')
    }
    // Pré-condições (dentro da tx para consistência)
    if (transition.requires.includes('agenda')) {
      const count = await tx.agendaItem.count({ where: { sessionId: session.id } })
      if (count === 0) {
        throw new DomainError(
          'SESSION_PRECONDITION',
          409,
          'Pré-condição não atendida',
          'A sessão precisa de ao menos 1 item na pauta para ser agendada.'
        )
      }
    }
    if (transition.requires.includes('president') && !session.presidentId) {
      throw new DomainError(
        'SESSION_PRECONDITION',
        409,
        'Pré-condição não atendida',
        'Sessão sem presidente definido — informe o presidente antes de abrir os trabalhos.'
      )
    }

    let publication: { agendaJson: string; policyJson: string; tenant: { id: string; slug: string; name: string; city: string; uf: string; timezone: string } } | null = null
    if (body.action === 'schedule') {
      const tenant = await tx.tenant.findUnique({ where: { id: session.tenantId } })
      if (!tenant) throw new DomainError('NOT_FOUND', 404, 'Câmara não encontrada', 'Câmara não encontrada.')
      if (session.official) {
        const inspection = await inspectOfficialConfiguration(tx, session.tenantId)
        const approved = await tx.officialConfigurationRevision.findFirst({
          where: { tenantId: session.tenantId }, orderBy: { version: 'desc' },
        })
        if (!inspection.ready || !approved || approved.snapshotSha256 !== inspection.snapshotSha256) {
          throw new DomainError('SESSION_PRECONDITION', 409, 'Configuração oficial pendente',
            'Esta sessão é oficial. Complete e aprove a configuração institucional atual da Câmara antes de publicar a pauta.')
        }
        const officialPresident = await tx.boardPosition.findFirst({
          where: { tenantId: session.tenantId, role: 'presidente', parliamentarianId: session.presidentId!,
            startDate: { lte: session.scheduledAt }, OR: [{ endDate: null }, { endDate: { gte: session.scheduledAt } }] },
          include: { legislature: true },
        })
        if (!officialPresident?.legislature.current || session.year < officialPresident.legislature.startYear || session.year > officialPresident.legislature.endYear) {
          throw new DomainError('SESSION_PRECONDITION', 409, 'Presidência da Mesa',
            'O presidente da sessão oficial deve ocupar a presidência da Mesa na legislatura vigente na data da sessão.')
        }
        const presidentialMandate = await tx.mandate.findFirst({ where: {
          tenantId: session.tenantId, legislatureId: officialPresident.legislatureId,
          parliamentarianId: session.presidentId!, startDate: { lte: session.scheduledAt },
          OR: [{ endDate: null }, { endDate: { gte: session.scheduledAt } }],
        } })
        if (!presidentialMandate) throw new DomainError('SESSION_PRECONDITION', 409, 'Mandato da Presidência',
          'O presidente da sessão oficial precisa ter mandato válido na data da sessão.')
        await tx.session.update({ where: { id: session.id }, data: { officialConfigurationId: approved.id } })
      }
      const policy = tenantSettings(tenant)
      const deadline = enforceNoticeDeadline({ settings: policy, sessionType: session.type,
        scheduledAt: session.scheduledAt, now, phase: 'initial', exceptionReason: body.noticeExceptionReason })
      if (!policy.enabledSessionTypes.includes(session.type as typeof policy.enabledSessionTypes[number])) {
        throw new DomainError('SESSION_TYPE_DISABLED', 409, 'Tipo indisponível', 'O tipo da sessão foi desabilitado nesta Câmara antes da publicação.')
      }
      if (policy.requireSecretaryForPublication && !session.secretaryName?.trim()) {
        throw new DomainError('SESSION_PRECONDITION', 409, 'Secretaria obrigatória', 'Esta Câmara exige secretário(a) identificado(a) para publicar a pauta.')
      }
      const president = session.presidentId && await tx.parliamentarian.findFirst({
        where: { id: session.presidentId, tenantId: session.tenantId, active: true },
      })
      if (!president) {
        throw new DomainError('SESSION_PRECONDITION', 409, 'Presidência inválida', 'Indique um presidente ativo desta Câmara antes de publicar.')
      }
      const agenda = await tx.agendaItem.findMany({
        where: { sessionId: session.id }, orderBy: [{ order: 'asc' }, { id: 'asc' }],
      })
      const matters = agenda.filter((item) => item.section === 'ordem_do_dia'
        && item.matterId && !['retirado', 'adiado'].includes(item.status)).length
      if (matters < policy.minimumAgendaMatters) {
        throw new DomainError('SESSION_PRECONDITION', 409, 'Pauta incompleta', `Esta Câmara exige ao menos ${policy.minimumAgendaMatters} matéria(s) na ordem do dia; há ${matters}.`)
      }
      publication = {
        agendaJson: JSON.stringify(agenda.map((item) => ({
          id: item.id, order: item.order, section: item.section, matterId: item.matterId,
          title: item.title, kind: item.kind, batchItems: item.batchItems,
        }))),
        policyJson: JSON.stringify({
          enabledSessionTypes: policy.enabledSessionTypes,
          requireSecretaryForPublication: policy.requireSecretaryForPublication,
          minimumAgendaMatters: policy.minimumAgendaMatters,
          minimumNoticeHours: policy.minimumNoticeHours,
          minimumAmendmentHours: policy.minimumAmendmentHours,
          urgentNoticeExceptionTypes: policy.urgentNoticeExceptionTypes,
          noticeRecipientPolicy: policy.noticeRecipientPolicy,
          exceptionReason: deadline.exceptionReason,
        }),
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, city: tenant.city, uf: tenant.uf, timezone: tenant.timezone },
      }
    }

    const data: Prisma.SessionUpdateManyMutationInput = {
      status: transition.to,
      version: { increment: 1 },
    }
    if (body.action === 'schedule') data.agendaPublished = true
    if (body.action === 'open_session') data.openedAt = now
    if (body.action === 'close') data.closedAt = now
    if (body.action === 'cancel' && body.justification) data.notes = session.notes ?? body.justification

    const changed = await tx.session.updateMany({ where: { id: session.id, tenantId: session.tenantId, status: from, version: session.version }, data })
    if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A sessão mudou. Recarregue antes de continuar.')
    const updated = await tx.session.findUniqueOrThrow({ where: { id: session.id } })
    let noticeHash: string | null = null
    if (publication) {
      const notice = createSessionNotice({
        tenant: publication.tenant, session: updated, revision: 1, issuedAt: now,
        agenda: JSON.parse(publication.agendaJson), policy: JSON.parse(publication.policyJson),
        exceptionReason: body.noticeExceptionReason,
      })
      noticeHash = notice.noticeSha256
      await tx.sessionAgendaRevision.create({ data: {
        tenantId: session.tenantId,
        sessionId: session.id,
        revision: 1,
        agendaJson: publication.agendaJson,
        policyJson: publication.policyJson,
        noticeJson: notice.noticeJson,
        noticeSha256: notice.noticeSha256,
        actorId: actor.id,
        createdAt: now,
      } })
      await snapshotNoticeRecipients(tx, { tenantId: session.tenantId, sessionId: session.id,
        revision: 1, noticeSha256: notice.noticeSha256, issuedAt: now })
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: `session.${body.action}`,
      aggregateType: 'session',
      aggregateId: session.id,
      summary: `${SUMMARY[body.action]} (status: ${from} → ${transition.to})`,
      before: { status: from },
      after: { status: transition.to, ...(publication ? { agendaRevision: 1, noticeSha256: noticeHash, noticeExceptionReason: body.noticeExceptionReason ?? null } : {}) },
      justification: body.action === 'cancel' ? body.justification : null,
      correlationId,
      ip: clientIp(req),
    })

    const { quorum } = await currentAttendance(tx, session.id, session.tenantId)
    const payload = {
      sessionId: session.id,
      from,
      to: transition.to,
      label: SESSION_STATUS_LABEL[transition.to],
      ...(noticeHash && { agendaRevision: 1, noticeSha256: noticeHash }),
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'session.state_changed',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: updated.version,
      correlationId,
      internalPayload: payload,
      publicPayload: payload,
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'session.quorum',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: updated.version,
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

    // Fase 6 — notificações internas (transições-chave da sessão)
    if (body.action === 'schedule') {
      await notify(tx, {
        tenantId: session.tenantId,
        title: `${sessionLabel(updated)} agendada`,
        body: `Pauta publicada. A sessão está marcada para ${updated.scheduledAt.toLocaleString('pt-BR')}.`,
        kind: 'session',
        module: 'sessions',
        targetRole: 'session_operator',
      })
    } else if (body.action === 'open_session') {
      await notify(tx, {
        tenantId: session.tenantId,
        title: `${sessionLabel(updated)} aberta`,
        body: `Sessão aberta com ${quorum.present} parlamentar(es) presente(s).`,
        kind: 'session',
        module: 'plenary',
        targetRole: null,
      })
    } else if (body.action === 'close') {
      await notify(tx, {
        tenantId: session.tenantId,
        title: `${sessionLabel(updated)} encerrada`,
        body: `Sessão encerrada com ${quorum.present} presente(s). Minuta de ata disponível em Relatórios.`,
        kind: 'session',
        module: 'reports',
        targetRole: null,
      })
    }

    return { updated, quorum }
  })

  const [summary] = await buildSessionSummaries(db, session.tenantId, [result.updated])
  return Response.json({ session: summary, quorum: result.quorum })
})
