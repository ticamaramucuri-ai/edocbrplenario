/**
 * POST /api/v1/votings/:id/transition — máquina da votação (ADR-002 §2).
 * open (sessão aberta + quórum ok, senão 409 QUORUM_INSUFFICIENT; snapshot),
 * pause/resume, close (snapshot, cálculo determinístico — Fase 18: multi-opção
 * via voting-service + emissão idempotente de recibos verificáveis ADR-019 —,
 * matéria/item atualizados, resultDetail nominal por bancada), annul
 * (justificativa, reverte item/matéria, limpa resultados) e cancel
 * (antes da abertura, com justificativa e restauração da pauta).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadVoting } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { notify } from '@/lib/server/notify'
import {
  VOTING_TRANSITIONS,
  currentAttendance,
  resultSummaryPhrase,
  tenantSettings,
} from '@/lib/server/domain'
import {
  computeVotingResultAdvanced,
  countsPhraseForNotify,
  customResultSummaryPhrase,
  issueVoteReceipts,
  type VotingOptionLite,
} from '@/lib/server/voting-service'
import { toVotingView, sessionLabel, parseResultCounts } from '@/lib/server/serializers'
import { VOTING_MODE_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    action: z.enum(['open', 'pause', 'resume', 'close', 'annul', 'cancel']),
    version: z.number({ message: 'version é obrigatório (controle otimista).' }).int().min(1),
    justification: z.string().trim().min(3).max(2000).optional(),
    sim: z.number().int().min(0).optional(),
    nao: z.number().int().min(0).optional(),
    abstencoes: z.number().int().min(0).optional(),
    /** Fase 18: contagem por chave para encerrar votação simbólica com opções customizadas. */
    customCounts: z.record(z.string(), z.number().int().min(0)).optional(),
  })
  .superRefine((body, ctx) => {
    if ((body.action === 'annul' || body.action === 'cancel') && !body.justification) {
      ctx.addIssue({
        code: 'custom',
        path: ['justification'],
        message: 'Justificativa é obrigatória para anular ou cancelar a votação.',
      })
    }
  })

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'voting.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const voting = await loadVoting(actor, id)
  const session = voting.session
  if (body.version !== voting.version) {
    throw new DomainError(
      'CONFLICT_VERSION',
      409,
      'Conflito de versão',
      `Versão informada (${body.version}) difere da atual (${voting.version}). Recarregue a votação.`
    )
  }

  const transition = VOTING_TRANSITIONS[body.action]
  if (!transition.from.includes(voting.status as (typeof transition.from)[number])) {
    throw new DomainError(
      'VOTING_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Ação "${body.action}" não é permitida com a votação "${voting.status}" (permitido: ${transition.from.join(', ')}).`
    )
  }

  // Pré-condição: abrir votação exige sessão aberta/retomada
  if (body.action === 'open' && !['open', 'resumed'].includes(session.status)) {
    throw new DomainError(
      'SESSION_PRECONDITION',
      409,
      'Pré-condição não atendida',
      'A sessão precisa estar aberta ou retomada para abrir a votação.'
    )
  }

  const result = await withTransaction(async (tx) => {
    const current = await tx.voting.findUniqueOrThrow({ where: { id: voting.id } })
    if (session.official && current.mode === 'secreto' && ['open', 'resume', 'close'].includes(body.action)) {
      throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Modalidade indisponível', 'Voto secreto oficial está desabilitado até revisão independente do sigilo.')
    }
    if (current.version !== body.version || current.status !== voting.status) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A votação mudou. Recarregue antes de executar a ação.')
    }
    if (['open', 'resume', 'close'].includes(body.action)) {
      const currentSession = await tx.session.findUniqueOrThrow({ where: { id: session.id } })
      if (!['open', 'resumed'].includes(currentSession.status)) throw new DomainError('SESSION_PRECONDITION', 409,
        'Sessão indisponível', 'A sessão precisa estar aberta ou retomada para esta ação.')
    }
    const now = new Date()

    // ── open ────────────────────────────────────────────────────────────
    if (body.action === 'open') {
      const { quorum: fullQuorum, rows: fullRows } = await currentAttendance(tx, session.id, session.tenantId)
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } })
      const policy = tenantSettings(tenant).votingImpedimentPolicy
      const impediments = await tx.votingImpediment.findMany({ where: { votingId: voting.id, revokedAt: null } })
      if (impediments.length > 0 && policy === 'disabled') throw new DomainError('VOTING_INVALID_TRANSITION', 409,
        'Política desativada', 'Há impedimentos registrados. Defina a política da Câmara ou revogue-os antes de abrir.')
      const impededIds = new Set(impediments.map((row) => row.parliamentarianId))
      if (impediments.some((row) => !fullRows.some((person) => person.parliamentarianId === row.parliamentarianId))) {
        throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Base deliberativa alterada',
          'Um parlamentar impedido não pertence mais à base deliberativa. Revogue o registro antes de abrir.')
      }
      const eligibleIds = fullRows.map((row) => row.parliamentarianId).filter((id) => !impededIds.has(id))
      const { quorum } = impediments.length > 0
        ? await currentAttendance(tx, session.id, session.tenantId, eligibleIds)
        : { quorum: fullQuorum }
      const required = voting.requiredQuorum ?? quorum.required
      const memberBase = policy === 'reduce_base' ? eligibleIds.length : fullQuorum.total
      if (quorum.present < required) {
        throw new DomainError(
          'QUORUM_INSUFFICIENT',
          409,
          'Quórum insuficiente',
          `Quórum insuficiente para abrir a votação: ${quorum.present} presente(s) de ${quorum.total} membros (mínimo regimental: ${required}).`
        )
      }
      const updated = await tx.voting.update({
        where: { id: voting.id },
        data: {
          status: 'open',
          openedAt: voting.openedAt ?? now,
          presentAtOpen: voting.presentAtOpen ?? quorum.present,
          quorumAtOpen: voting.quorumAtOpen ?? required,
          memberBaseAtOpen: memberBase,
          eligibleVoterIdsAtOpen: JSON.stringify(eligibleIds),
          impedimentPolicyAtOpen: impediments.length > 0 ? policy : null,
          version: voting.version + 1,
        },
      })
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actor,
        action: 'voting.opened',
        aggregateType: 'voting',
        aggregateId: voting.id,
        summary: `Votação aberta: ${voting.question.slice(0, 80)} (presentes: ${quorum.present}).`,
        before: { status: voting.status },
        after: { status: 'open', presentAtOpen: quorum.present, quorumAtOpen: required,
          memberBaseAtOpen: memberBase, impedimentPolicyAtOpen: impediments.length > 0 ? policy : null,
          eligibleVoterIdsAtOpen: eligibleIds },
        correlationId,
        ip: clientIp(req),
      })
      return { voting: updated }
    }

    // ── pause / resume ──────────────────────────────────────────────────
    if (body.action === 'pause' || body.action === 'resume') {
      const updated = await tx.voting.update({
        where: { id: voting.id },
        data: { status: transition.to, version: voting.version + 1 },
      })
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actor,
        action: `voting.${body.action}d`,
        aggregateType: 'voting',
        aggregateId: voting.id,
        summary: `Votação ${body.action === 'pause' ? 'pausada' : 'retomada'}: ${voting.question.slice(0, 80)}`,
        before: { status: voting.status },
        after: { status: transition.to },
        correlationId,
        ip: clientIp(req),
      })
      return { voting: updated }
    }

    // ── cancel: votação pronta, sem abertura ou votos ─────────────────────
    if (body.action === 'cancel') {
      const updated = await tx.voting.update({ where: { id: voting.id }, data: {
        status: 'cancelled', justification: body.justification, version: { increment: 1 },
      } })
      if (voting.agendaItemId) {
        const before = voting.agendaBefore
          ? JSON.parse(voting.agendaBefore) as { status: string; resultSummary: string | null }
          : { status: 'em_discussao', resultSummary: null }
        const changed = await tx.agendaItem.updateMany({ where: { id: voting.agendaItemId, status: 'em_votacao' },
          data: { status: before.status, resultSummary: before.resultSummary } })
        if (changed.count !== 1) throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Pauta alterada',
          'O item de pauta mudou desde a criação da votação. Revise a pauta antes de cancelar.')
      }
      await writeAudit(tx, { tenantId: session.tenantId, actor, action: 'voting.cancelled',
        aggregateType: 'voting', aggregateId: voting.id,
        summary: `Votação cancelada antes da abertura: ${voting.question.slice(0, 80)}.`,
        before: { status: voting.status }, after: { status: 'cancelled' },
        justification: body.justification, correlationId, ip: clientIp(req) })
      const payload = { votingId: voting.id, sessionId: session.id, status: 'cancelled', question: voting.question }
      await emitOutbox(tx, { tenantId: session.tenantId, eventType: 'voting.state_changed',
        aggregateId: voting.id, sessionId: session.id, aggregateVersion: updated.version,
        correlationId, internalPayload: payload, publicPayload: payload })
      if (voting.agendaItemId) await emitOutbox(tx, { tenantId: session.tenantId, eventType: 'agenda.updated',
        aggregateId: session.id, sessionId: session.id, aggregateVersion: session.version,
        correlationId, internalPayload: { sessionId: session.id }, publicPayload: { sessionId: session.id } })
      return { voting: updated }
    }

    // ── close ───────────────────────────────────────────────────────────
    if (body.action === 'close') {
      const frozenIds = voting.eligibleVoterIdsAtOpen ? JSON.parse(voting.eligibleVoterIdsAtOpen) as string[] : null
      const { quorum, statuses } = await currentAttendance(tx, session.id, session.tenantId, frozenIds)
      const required = voting.quorumAtOpen ?? voting.requiredQuorum ?? quorum.required
      const [votes, optionRows] = await Promise.all([
        tx.vote.findMany({
          where: { votingId: voting.id },
          include: { parliamentarian: true },
        }),
        tx.votingOption.findMany({ where: { votingId: voting.id }, orderBy: { order: 'asc' } }),
      ])
      const customOptions: VotingOptionLite[] = optionRows

      let countsSimbolico: { sim: number; nao: number; abstencoes: number } | undefined
      let customCounts: Record<string, number> | undefined
      if (voting.mode === 'simbolico') {
        const confirmed = session.official ? await tx.symbolicTallyRevision.findFirst({
          where: { votingId: voting.id }, orderBy: { revision: 'desc' },
        }) : null
        if (session.official && !confirmed?.confirmedAt) {
          throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Contagem sem conferência',
            'A votação simbólica oficial exige proposta e confirmação por pessoas distintas antes do encerramento.')
        }
        const officialCounts = confirmed ? JSON.parse(confirmed.countsJson) as Record<string, number> : null
        if (officialCounts && (body.customCounts || body.sim !== undefined || body.nao !== undefined || body.abstencoes !== undefined)) {
          throw new DomainError('VALIDATION_ERROR', 422, 'Contagem já confirmada',
            'No encerramento oficial, a contagem vem da revisão confirmada; não a envie novamente.')
        }
        if (customOptions.length > 0) {
          // Fase 18: simbólica com opções customizadas → contagem por chave
          if (!body.customCounts && !officialCounts) {
            throw new DomainError(
              'VALIDATION_ERROR',
              422,
              'Dados inválidos',
              'Votação simbólica com opções customizadas exige customCounts (contagem por chave) no corpo da requisição.',
              {
                errors: {
                  customCounts: [
                    `Informe a contagem por chave de cada opção (${customOptions
                      .map((o) => o.key)
                      .join(', ')}).`,
                  ],
                },
              }
            )
          }
          const optionKeys = new Set(customOptions.map((o) => o.key))
          const suppliedCounts = body.customCounts ?? officialCounts ?? {}
          const unknown = Object.keys(suppliedCounts).filter((k) => !optionKeys.has(k))
          const missing = customOptions.filter((o) => suppliedCounts[o.key] === undefined)
          if (unknown.length > 0 || missing.length > 0) {
            throw new DomainError(
              'VALIDATION_ERROR',
              422,
              'Dados inválidos',
              'Contagens informadas não correspondem às opções da votação.',
              {
                errors: {
                  customCounts: [
                    `${
                      missing.length > 0
                        ? `Chaves ausentes: ${missing.map((o) => o.key).join(', ')}.`
                        : ''
                    }${unknown.length > 0 ? ` Chaves desconhecidas: ${unknown.join(', ')}.` : ''}`.trim(),
                  ],
                },
              }
            )
          }
          customCounts = suppliedCounts
        } else if (
          (officialCounts?.sim ?? body.sim) === undefined ||
          (officialCounts?.nao ?? body.nao) === undefined ||
          (officialCounts?.abstencoes ?? body.abstencoes) === undefined
        ) {
          throw new DomainError(
            'VALIDATION_ERROR',
            422,
            'Dados inválidos',
            'Votação simbólica exige as contagens sim/nao/abstencoes no corpo da requisição.',
            {
              errors: {
                sim: body.sim === undefined ? ['Informe o número de votos sim.'] : [],
                nao: body.nao === undefined ? ['Informe o número de votos não.'] : [],
                abstencoes: body.abstencoes === undefined ? ['Informe o número de abstenções.'] : [],
              },
            }
          )
        } else {
          countsSimbolico = { sim: (officialCounts?.sim ?? body.sim)!, nao: (officialCounts?.nao ?? body.nao)!,
            abstencoes: (officialCounts?.abstencoes ?? body.abstencoes)! }
        }
      }

      const symbolicTotal = customCounts
        ? Object.values(customCounts).reduce((sum, count) => sum + count, 0)
        : countsSimbolico ? countsSimbolico.sim + countsSimbolico.nao + countsSimbolico.abstencoes : 0
      if (voting.mode === 'simbolico' && symbolicTotal > quorum.present) {
        throw new DomainError('VALIDATION_ERROR', 422, 'Contagem inválida',
          `A soma informada (${symbolicTotal}) excede os ${quorum.present} parlamentares presentes no fechamento.`)
      }

      const computed = computeVotingResultAdvanced({
        rule: voting.rule as 'maioria_simples',
        options: customOptions,
        votes: votes.map((v) => ({ value: v.value })),
        countsSimbolico,
        customCounts,
        presentCount: quorum.present,
        totalMembers: voting.memberBaseAtOpen ?? quorum.total,
        requiredQuorum: required,
      })

      // Detalhe nominal por ordem de bancada (presentes; sem voto → nao_registrado)
      let resultDetail: string | null = null
      if (voting.mode === 'nominal') {
        const voteByParl = new Map(votes.map((v) => [v.parliamentarianId, v]))
        const presentIds = new Set(
          [...statuses.entries()].filter(([, st]) => st === 'presente').map(([pid]) => pid)
        )
        const bancada = (
          await tx.parliamentarian.findMany({
            where: { tenantId: session.tenantId, active: true },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
          })
        ).filter((p) => presentIds.has(p.id))
        resultDetail = JSON.stringify(
          bancada.map((p, i) => ({
            parliamentarianId: p.id,
            name: p.name,
            value: voteByParl.get(p.id)?.value ?? 'nao_registrado',
            order: i,
          }))
        )
      }

      const closed = await tx.voting.updateMany({
        where: { id: voting.id, version: voting.version, status: voting.status },
        data: {
          status: 'closed',
          closedAt: now,
          presentAtClose: quorum.present,
          quorumAtClose: required,
          resultStatus: computed.resultStatus,
          resultCounts: JSON.stringify(computed.counts),
          resultDetail,
          version: { increment: 1 },
        },
      })
      if (closed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão',
        'A votação foi alterada durante o encerramento. Atualize e tente novamente.')
      const updated = await tx.voting.findUniqueOrThrow({ where: { id: voting.id } })

      // Fase 18 (ADR-019): recibos verificáveis na MESMA transação — nominal e
      // secreto emitem um recibo por voto; simbólico apenas com votos individuais;
      // secreto usa placeholder (prova de participação sem correlação).
      await issueVoteReceipts(tx, {
        tenantId: session.tenantId,
        votingId: voting.id,
        question: voting.question,
        mode: voting.mode,
        closedAt: updated.closedAt ?? now,
        votes: votes.map((v) => ({ parliamentarianId: v.parliamentarianId, value: v.value })),
        actor,
        correlationId,
        ip: clientIp(req),
      })

      // Matéria vinculada: aprovado/rejeitado; empate/sem_quorum mantém pauta
      if (voting.matterId) {
        const matterStatus =
          computed.resultStatus === 'aprovado'
            ? 'aprovado'
            : computed.resultStatus === 'rejeitado'
              ? 'rejeitado'
              : 'incluida_pauta'
        await tx.legislativeMatter.update({
          where: { id: voting.matterId },
          data: { status: matterStatus },
        })
      }

      // Item da pauta: resultado + frase-resumo (Fase 18: frase multi-opção)
      let agendaChanged = false
      if (voting.agendaItemId) {
        const itemStatus =
          computed.resultStatus === 'aprovado'
            ? 'aprovado'
            : computed.resultStatus === 'rejeitado'
              ? 'rejeitado'
              : 'em_discussao'
        await tx.agendaItem.update({
          where: { id: voting.agendaItemId },
          data: {
            status: itemStatus,
            resultSummary:
              customOptions.length > 0
                ? customResultSummaryPhrase(computed.resultStatus, computed.counts, customOptions)
                : resultSummaryPhrase(computed.resultStatus, computed.counts),
          },
        })
        agendaChanged = true
      }

      await writeAudit(tx, {
        tenantId: session.tenantId,
        actor,
        action: 'voting.closed',
        aggregateType: 'voting',
        aggregateId: voting.id,
        summary: `Votação encerrada: ${voting.question.slice(0, 60)} — resultado ${computed.resultStatus}.`,
        before: { status: voting.status },
        after: {
          status: 'closed',
          resultStatus: computed.resultStatus,
          resultCounts: computed.counts,
        },
        correlationId,
        ip: clientIp(req),
      })

      const statePayload = {
        votingId: voting.id,
        sessionId: session.id,
        status: 'closed',
        question: voting.question,
      }
      await emitOutbox(tx, {
        tenantId: session.tenantId,
        eventType: 'voting.state_changed',
        aggregateId: voting.id,
        sessionId: session.id,
        aggregateVersion: updated.version,
        correlationId,
        internalPayload: statePayload,
        publicPayload: statePayload,
      })

      const resultPayloadBase = {
        votingId: voting.id,
        sessionId: session.id,
        question: voting.question,
        resultStatus: computed.resultStatus,
        resultCounts: computed.counts,
      }
      const resultInternal = {
        ...resultPayloadBase,
        nominalDetail: voting.mode !== 'secreto' ? JSON.parse(resultDetail ?? 'null') : null,
      }
      await emitOutbox(tx, {
        tenantId: session.tenantId,
        eventType: 'voting.result',
        aggregateId: voting.id,
        sessionId: session.id,
        aggregateVersion: updated.version,
        correlationId,
        internalPayload: resultInternal,
        publicPayload: resultInternal,
      })

      if (agendaChanged) {
        await emitOutbox(tx, {
          tenantId: session.tenantId,
          eventType: 'agenda.updated',
          aggregateId: session.id,
          sessionId: session.id,
          aggregateVersion: session.version,
          correlationId,
          internalPayload: { sessionId: session.id },
          publicPayload: { sessionId: session.id },
        })
      }

      // Fase 6 — notificação de votação encerrada com resultado
      const resultLabels: Record<string, string> = {
        aprovado: 'APROVADO',
        rejeitado: 'REJEITADO',
        empate: 'EMPATE',
        sem_quorum: 'SEM QUÓRUM',
      }
      await notify(tx, {
        tenantId: session.tenantId,
        title: `Resultado: ${voting.question.slice(0, 90)}`,
        body: `${sessionLabel(session)} — votação ${VOTING_MODE_LABEL[voting.mode as 'nominal'] ?? voting.mode} encerrada: ${
          resultLabels[computed.resultStatus] ?? computed.resultStatus
        } (${countsPhraseForNotify(computed.counts, customOptions)}).`,
        kind: 'voting',
        module: 'sessions',
        targetRole: null,
      })

      return { voting: updated }
    }

    // ── annul ───────────────────────────────────────────────────────────
    if (voting.matterId || voting.agendaItemId) {
      const related = await tx.voting.findMany({ where: {
        ...(voting.matterId ? { matterId: voting.matterId } : { agendaItemId: voting.agendaItemId }),
        status: { in: ['ready', 'open', 'paused', 'closed'] },
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } })
      if (related[0]?.id !== voting.id) throw new DomainError('VOTING_INVALID_TRANSITION', 409,
        'Deliberação posterior', 'Há outra votação válida ou pendente para esta matéria. Revise a deliberação mais recente antes de anular esta.')
    }
    const expectedMatterStatus = voting.resultStatus === 'aprovado' ? 'aprovado'
      : voting.resultStatus === 'rejeitado' ? 'rejeitado' : 'incluida_pauta'
    const expectedAgendaStatus = voting.resultStatus === 'aprovado' ? 'aprovado'
      : voting.resultStatus === 'rejeitado' ? 'rejeitado' : 'em_discussao'
    if (voting.matterId) {
      const matter = await tx.legislativeMatter.findUniqueOrThrow({ where: { id: voting.matterId } })
      if (matter.status !== expectedMatterStatus) throw new DomainError('VOTING_INVALID_TRANSITION', 409,
        'Matéria alterada', 'A situação da matéria mudou após esta votação. Revise o processo antes de anular.')
    }
    if (voting.agendaItemId) {
      const item = await tx.agendaItem.findUniqueOrThrow({ where: { id: voting.agendaItemId } })
      if (item.status !== expectedAgendaStatus) throw new DomainError('VOTING_INVALID_TRANSITION', 409,
        'Pauta alterada', 'O item de pauta mudou após esta votação. Revise a pauta antes de anular.')
    }
    const annulled = await tx.voting.updateMany({
      where: { id: voting.id, version: voting.version, status: voting.status },
      data: {
        status: 'annulled',
        resultStatus: 'anulado',
        resultCounts: null,
        resultDetail: null,
        justification: body.justification ?? null,
        version: { increment: 1 },
      },
    })
    if (annulled.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão',
      'A votação foi alterada durante a anulação. Atualize antes de tentar novamente.')
    const updated = await tx.voting.findUniqueOrThrow({ where: { id: voting.id } })
    if (voting.matterId) {
      await tx.legislativeMatter.update({
        where: { id: voting.matterId },
        data: { status: 'incluida_pauta' },
      })
    }
    if (voting.agendaItemId) {
      await tx.agendaItem.update({
        where: { id: voting.agendaItemId },
        data: { status: 'em_discussao', resultSummary: null },
      })
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'voting.annulled',
      aggregateType: 'voting',
      aggregateId: voting.id,
      summary: `Votação anulada: ${voting.question.slice(0, 60)} — item e matéria revertidos.`,
      before: { status: voting.status, resultStatus: voting.resultStatus,
        resultCounts: parseResultCounts(voting.resultCounts),
        memberBaseAtOpen: voting.memberBaseAtOpen },
      after: { status: 'annulled', resultStatus: 'anulado' },
      justification: body.justification ?? null,
      correlationId,
      ip: clientIp(req),
    })

    const annulPayload = {
      votingId: voting.id,
      sessionId: session.id,
      status: 'annulled',
      question: voting.question,
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'voting.state_changed',
      aggregateId: voting.id,
      sessionId: session.id,
      aggregateVersion: updated.version,
      correlationId,
      internalPayload: annulPayload,
      publicPayload: annulPayload,
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'agenda.updated',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
      internalPayload: { sessionId: session.id },
      publicPayload: { sessionId: session.id },
    })

    return { voting: updated }
  })

  const fresh = await db.voting.findUnique({
    where: { id: result.voting.id },
    include: {
      votes: { include: { parliamentarian: true } },
      options: { orderBy: { order: 'asc' } },
    },
  })
  const votesOrdered = [...(fresh?.votes ?? [])].sort(
    (a, b) => a.parliamentarian.order - b.parliamentarian.order
  )
  return Response.json({ voting: toVotingView(fresh!, votesOrdered) })
})
