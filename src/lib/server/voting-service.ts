/**
 * Serviço compartilhado de registro de voto (Fase 7) e motor da Fase 18
 * (Onda 4): validação do valor contra as opções da votação (padrão
 * sim/nao/abstencao ou opções customizadas), apuração multi-opção e emissão
 * idempotente de recibos verificáveis no fechamento (ADR-019).
 *
 * Usado pela rota do operador (POST /votings/:id/votes) e pelo App do
 * Parlamentar (POST /me/vote) — MESMAS regras em ambos os canais (ADR-002 §3):
 * votação aberta, parlamentar PRESENTE, idempotência por commandId, alteração
 * conforme tenant.settings.allowVoteChange, sigilo da votação secreta
 * (auditoria sem valor, outbox público só com contagem).
 */
import { db } from '@/lib/db'
import { withTransaction } from './tx'
import { DomainError } from './errors'
import type { ResolvedActor } from './actor'
import { loadVoting, loadParliamentarian } from './loaders'
import { writeAudit } from './audit'
import { emitOutbox } from './outbox'
import { computeVotingResult, currentAttendance, tenantSettings } from './domain'
import { computeReceipt, SECRET_VOTE_PLACEHOLDER } from './receipts'
import type { ResultCounts, VoteValue, VotingRule } from '@/lib/contracts'
import { Prisma, type Parliamentarian, type Vote, type Voting } from '@prisma/client'

export type VoteValueInput = 'sim' | 'nao' | 'abstencao'
export type CastVoteSource = 'operator' | 'pwa'

export type CastVoteArgs = {
  actor: ResolvedActor
  votingId: string
  parliamentarianId: string
  /** 'sim' | 'nao' | 'abstencao' ou chave de VotingOption customizada. */
  value: string
  commandId: string
  correlationId: string
  ip?: string | null
  source?: CastVoteSource
}

export type CastVoteResult = {
  vote: Vote & { parliamentarian: Parliamentarian }
  registeredCount: number
  voting: Pick<Voting, 'id' | 'sessionId' | 'version' | 'hidePartial' | 'mode' | 'status'>
}

export async function castVote(args: CastVoteArgs): Promise<CastVoteResult> {
  const { actor, votingId, parliamentarianId, value, commandId, correlationId } = args
  const source = args.source ?? 'operator'

  const voting = await loadVoting(actor, votingId)
  if (voting.session.official && voting.mode === 'secreto') {
    throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Modalidade indisponível', 'Voto secreto oficial está desabilitado até revisão independente do sigilo.')
  }
  const parliamentarian = await loadParliamentarian(actor, parliamentarianId)
  // A resposta pode se perder depois do commit. O mesmo comando confirma o
  // registro existente mesmo se a Mesa encerrou a votação nesse intervalo.
  const previousCommand = await db.vote.findUnique({
    where: { votingId_commandId: { votingId: voting.id, commandId } },
    include: { parliamentarian: true },
  })
  if (previousCommand) {
    if (previousCommand.parliamentarianId !== parliamentarian.id ||
        previousCommand.actorId !== actor.id || previousCommand.value !== value) {
      throw new DomainError('VOTE_DUPLICATE_COMMAND', 409, 'Comando duplicado',
        'O commandId informado já foi utilizado com outro ator, parlamentar ou valor nesta votação.')
    }
    return {
      vote: previousCommand,
      registeredCount: await db.vote.count({ where: { votingId: voting.id } }),
      voting,
    }
  }
  if (voting.status !== 'open') {
    throw new DomainError(
      'VOTING_NOT_OPEN',
      409,
      'Votação não está aberta',
      `A votação está "${voting.status}" — votos só são aceitos com ela aberta.`
    )
  }

  // Fase 18: o valor é validado contra as opções da votação — customizadas
  // (chaves de VotingOption) quando existem, padrão regimental caso contrário.
  const options = await db.votingOption.findMany({
    where: { votingId: voting.id },
    orderBy: { order: 'asc' },
  })
  assertVoteValueAllowed(value, options)

  return withTransaction(async (tx) => {
    const currentVoting = await tx.voting.findUniqueOrThrow({ where: { id: voting.id }, include: { session: true } })
    if (currentVoting.session.official && currentVoting.mode === 'secreto') {
      throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Modalidade indisponível', 'Voto secreto oficial está desabilitado.')
    }
    if (currentVoting.status !== 'open' || !['open', 'resumed'].includes(currentVoting.session.status)) {
      throw new DomainError('VOTING_NOT_OPEN', 409, 'Votação indisponível',
        'A votação e a sessão precisam estar abertas para registrar votos.')
    }
    const frozenIds = voting.eligibleVoterIdsAtOpen ? JSON.parse(voting.eligibleVoterIdsAtOpen) as string[] : null
    const { statuses } = await currentAttendance(tx, voting.sessionId, voting.session.tenantId, frozenIds)
    if (statuses.get(parliamentarian.id) !== 'presente') {
      throw new DomainError(
        'VOTE_PARLIAMENTARIAN_NOT_PRESENT',
        409,
        'Parlamentar não presente',
        `${parliamentarian.name} não está com presença ativa nesta sessão (status atual: ${statuses.get(parliamentarian.id) ?? 'ausente'}).`
      )
    }

    const byCommand = await tx.vote.findUnique({
      where: { votingId_commandId: { votingId: voting.id, commandId } },
      include: { parliamentarian: true },
    })
    if (byCommand && (byCommand.parliamentarianId !== parliamentarian.id ||
        byCommand.actorId !== actor.id || byCommand.value !== value)) {
      throw new DomainError(
        'VOTE_DUPLICATE_COMMAND',
        409,
        'Comando duplicado',
        'O commandId informado já foi utilizado com outro ator, parlamentar ou valor nesta votação.'
      )
    }

    const existing = await tx.vote.findUnique({
      where: { votingId_parliamentarianId: { votingId: voting.id, parliamentarianId: parliamentarian.id } },
      include: { parliamentarian: true },
    })

    let vote: typeof existing
    let action: 'vote.cast' | 'vote.changed' | null = null
    let beforeValue: string | undefined

    if (byCommand) {
      // Idempotência: mesmo commandId → retorna estado atual sem regravar
      vote = byCommand
    } else if (existing) {
      const tenant = await tx.tenant.findUnique({ where: { id: voting.session.tenantId } })
      const settings = tenantSettings(tenant ?? { settings: '{}' })
      if (!settings.allowVoteChange) {
        throw new DomainError(
          'VOTE_CHANGE_NOT_ALLOWED',
          409,
          'Alteração de voto não permitida',
          'A política do tenant (settings.allowVoteChange=false) não permite alterar o voto registrado.'
        )
      }
      beforeValue = existing.value
      vote = await tx.vote.update({
        where: { id: existing.id },
        data: {
          value,
          commandId,
          actorId: actor.id,
          changedAt: new Date(),
        },
        include: { parliamentarian: true },
      })
      action = 'vote.changed'
    } else {
      vote = await tx.vote.create({
        data: {
          votingId: voting.id,
          parliamentarianId: parliamentarian.id,
          value,
          commandId,
          actorId: actor.id,
        },
        include: { parliamentarian: true },
      })
      action = 'vote.cast'
    }

    const registeredCount = await tx.vote.count({ where: { votingId: voting.id } })
    const secret = voting.mode === 'secreto'
    const origin = source === 'pwa' ? ' — origem: app do parlamentar' : ''

    if (action) {
      await writeAudit(tx, {
        tenantId: voting.session.tenantId,
        actor,
        action,
        aggregateType: 'vote',
        aggregateId: voting.id,
        summary: secret
          ? `Voto secreto ${action === 'vote.changed' ? 'alterado' : 'registrado'} por ${parliamentarian.name}${origin}.`
          : `${action === 'vote.changed' ? 'Voto alterado' : 'Voto registrado'} por ${parliamentarian.name} (${value})${origin}.`,
        before:
          action === 'vote.changed'
            ? secret
              ? { parliamentarianId: parliamentarian.id }
              : { value: beforeValue }
            : null,
        after: secret ? { parliamentarianId: parliamentarian.id, source } : { value, source },
        correlationId,
        ip: args.ip ?? null,
      })
    }

    if (action) {
      const internalPayload: Record<string, unknown> = {
        votingId: voting.id,
        sessionId: voting.sessionId,
        parliamentarianId: parliamentarian.id,
        name: parliamentarian.name,
        party: parliamentarian.party,
        registeredCount,
        hidePartial: voting.hidePartial,
      }
      if (!secret) internalPayload.value = value
      await emitOutbox(tx, {
        tenantId: voting.session.tenantId,
        eventType: 'vote.recorded',
        aggregateId: voting.id,
        sessionId: voting.sessionId,
        aggregateVersion: voting.version,
        correlationId,
        origin: source === 'pwa' ? 'pwa' : 'operator',
        internalPayload,
        // Público SEMPRE sem valor/nome — apenas contagem
        publicPayload: {
          votingId: voting.id,
          sessionId: voting.sessionId,
          registeredCount,
          hidePartial: voting.hidePartial,
        },
      })
    }

    return { vote: vote as Vote & { parliamentarian: Parliamentarian }, registeredCount, voting }
  }).catch(async (error: unknown) => {
    // Duas instâncias podem ler a ausência da mesma chave antes do INSERT.
    // O índice único decide; após P2002, confirmar o comando vencedor sem
    // criar outro voto, recibo, auditoria ou evento na instância perdedora.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const committed = await db.vote.findUnique({
        where: { votingId_commandId: { votingId: voting.id, commandId } },
        include: { parliamentarian: true },
      })
      if (committed) {
        if (committed.parliamentarianId !== parliamentarian.id ||
            committed.actorId !== actor.id || committed.value !== value) {
          throw new DomainError('VOTE_DUPLICATE_COMMAND', 409, 'Comando duplicado',
            'O commandId informado já foi utilizado com outro ator, parlamentar ou valor nesta votação.')
        }
        return { vote: committed, registeredCount: await db.vote.count({ where: { votingId: voting.id } }), voting }
      }
    }
    throw error
  })
}

// ─── Fase 18 (Onda 4): opções customizadas ─────────────────────────────────

export type VotingOptionLite = { key: string; label: string; order: number }

export const STANDARD_VOTE_VALUES: VoteValue[] = ['sim', 'nao', 'abstencao']

/**
 * Valida o valor do voto contra as opções da votação:
 * - com VotingOptions: `value` DEVE ser uma das chaves (422 "chave de opção
 *   inexistente" com erro de campo);
 * - sem opções: comportamento padrão (sim|nao|abstencao).
 */
export function assertVoteValueAllowed(value: string, options: VotingOptionLite[]): void {
  if (options.length > 0) {
    if (!options.some((o) => o.key === value)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        `Chave de opção inexistente: "${value}".`,
        {
          errors: {
            value: [
              `Chave de opção inexistente: "${value}". Chaves válidas nesta votação: ${options
                .map((o) => o.key)
                .join(', ')}.`,
            ],
          },
        }
      )
    }
    return
  }
  if (!STANDARD_VOTE_VALUES.includes(value as VoteValue)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Dados inválidos', 'Valor de voto inválido.', {
      errors: { value: ['Informe "sim", "nao" ou "abstencao".'] },
    })
  }
}

// ─── Fase 18 (Onda 4): apuração multi-opção ────────────────────────────────

export type ComputedVotingResult = {
  resultStatus: 'aprovado' | 'rejeitado' | 'empate' | 'sem_quorum'
  counts: ResultCounts
}

/**
 * Apuração determinística da votação — generalização multi-opção de
 * computeVotingResult (domain.ts, ADR-002 §5):
 * - sem opções customizadas → delega para a lógica histórica (inalterada);
 * - com opções: contagem por chave em `resultCounts.custom` (sim/nao/abstencoes
 *   ficam 0; naoRegistraram/presentes mantidos), ordenação determinística por
 *   contagem desc + ordem da opção, e a regra regimental sobre a mais votada:
 *   · maioria_simples: mais votada dentre quem votou (empate entre as duas
 *     maiores → `empate`);
 *   · maioria_absoluta: mais votada > metade da base de membros na abertura;
 *   · unanimidade: todos os votos na mesma opção (≥ 1 voto).
 * `sem_quorum` segue ANTES de qualquer regra, como hoje.
 */
export function computeVotingResultAdvanced(input: {
  rule: VotingRule
  options: VotingOptionLite[]
  votes?: Array<{ value: string }>
  countsSimbolico?: { sim: number; nao: number; abstencoes: number }
  /** Votação simbólica com opções customizadas: contagem por chave informada pela mesa. */
  customCounts?: Record<string, number>
  presentCount: number
  totalMembers: number
  requiredQuorum: number
}): ComputedVotingResult {
  const { options, presentCount } = input

  if (options.length === 0) {
    return computeVotingResult({
      rule: input.rule,
      votes: input.votes as Array<{ value: VoteValue }> | undefined,
      countsSimbolico: input.countsSimbolico,
      presentCount: input.presentCount,
      totalMembers: input.totalMembers,
      requiredQuorum: input.requiredQuorum,
    })
  }

  // Contagem por chave (todas as opções entram, inclusive com 0 — determinístico)
  const counts: Record<string, number> = {}
  for (const o of options) counts[o.key] = 0
  let totalVotes = 0
  if (input.customCounts) {
    for (const o of options) {
      const n = input.customCounts[o.key] ?? 0
      counts[o.key] = n
      totalVotes += n
    }
  } else {
    for (const v of input.votes ?? []) {
      if (v.value in counts) {
        counts[v.value] += 1
        totalVotes += 1
      }
    }
  }

  const resultCounts: ResultCounts = {
    sim: 0,
    nao: 0,
    abstencoes: 0,
    naoRegistraram: Math.max(0, presentCount - totalVotes),
    presentes: presentCount,
    custom: { ...counts },
  }

  if (presentCount < input.requiredQuorum) {
    return { resultStatus: 'sem_quorum', counts: resultCounts }
  }

  // Ordenação determinística: contagem desc → ordem regimental da opção asc.
  const ranked = [...options].sort((a, b) => counts[b.key] - counts[a.key] || a.order - b.order)
  const top = ranked[0]
  const second = ranked[1] ?? null
  const topCount = counts[top.key]
  const secondCount = second ? counts[second.key] : 0

  switch (input.rule) {
    case 'maioria_absoluta':
      // Mesmo denominador da votação padrão; base congelada na abertura.
      return {
        resultStatus: topCount > Math.floor(input.totalMembers / 2) ? 'aprovado' : 'rejeitado',
        counts: resultCounts,
      }
    case 'unanimidade':
      // todos os votos registrados na mesma opção (ao menos 1 voto)
      return {
        resultStatus:
          totalVotes > 0 && Object.values(counts).filter((n) => n > 0).length === 1
            ? 'aprovado'
            : 'rejeitado',
        counts: resultCounts,
      }
    case 'maioria_simples':
    default:
      return {
        resultStatus: topCount > secondCount ? 'aprovado' : 'empate',
        counts: resultCounts,
      }
  }
}

/** Frase-resumo do resultado para votações com opções customizadas. */
export function customResultSummaryPhrase(
  resultStatus: string,
  counts: ResultCounts,
  options: VotingOptionLite[]
): string {
  const custom = counts.custom ?? {}
  const ranked = [...options]
    .map((o) => ({ label: o.label, n: custom[o.key] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  if (ranked.length === 0) return `Resultado: ${resultStatus}.`
  const top = ranked[0]
  const withVotes = ranked.filter((o) => o.n > 0)
  const votesPhrase = (list: Array<{ label: string; n: number }>) =>
    list
      .map((o) => `${o.n} ${o.n > 1 ? 'votos' : 'voto'} “${o.label}”`)
      .join(', ')
  switch (resultStatus) {
    case 'aprovado': {
      const others = withVotes.filter((o) => o !== top)
      return `Aprovado — opção mais votada: “${top.label}” (${top.n} ${top.n === 1 ? 'voto' : 'votos'})${
        others.length > 0 ? `; demais: ${votesPhrase(others)}` : ''
      }.`
    }
    case 'rejeitado':
      return `Rejeitado — nenhuma opção alcançou a maioria exigida (mais votada: “${top.label}”, ${top.n} ${
        top.n === 1 ? 'voto' : 'votos'
      }).`
    case 'empate':
      return withVotes.length > 0
        ? `Empate entre as opções mais votadas (${votesPhrase(withVotes.filter((o) => o.n === top.n))}).`
        : 'Empate na votação sem votos registrados.'
    case 'sem_quorum':
      return `Votação encerrada sem quórum (${counts.presentes} presentes).`
    default:
      return `Resultado: ${resultStatus}${withVotes.length > 0 ? ` (${votesPhrase(withVotes)})` : ''}.`
  }
}

/** Corpo curto da notificação de encerramento (contagens por rótulo). */
export function countsPhraseForNotify(counts: ResultCounts, options: VotingOptionLite[]): string {
  const custom = counts.custom
  if (!custom) {
    return `Sim ${counts.sim} · Não ${counts.nao} · Abst. ${counts.abstencoes}`
  }
  return options
    .slice()
    .sort((a, b) => (custom[b.key] ?? 0) - (custom[a.key] ?? 0) || a.order - b.order)
    .map((o) => `“${o.label}” ${custom[o.key] ?? 0}`)
    .join(' · ')
}

// ─── Fase 18 (Onda 4): recibos verificáveis no fechamento ──────────────────

export type IssueReceiptsArgs = {
  tenantId: string
  votingId: string
  question: string
  mode: string
  closedAt: Date
  votes: Array<{ parliamentarianId: string; value: string }>
  actor: ResolvedActor
  correlationId: string
  ip?: string | null
}

/**
 * Emite os recibos verificáveis (HMAC determinístico, ADR-019) na MESMA
 * transação do fechamento:
 * - nominal e secreto: um recibo por voto registrado;
 * - simbólico: apenas quando há votos individuais registrados;
 * - secreto: o recibo usa SECRET_VOTE_PLACEHOLDER no lugar do valor (prova de
 *   participação, sem correlação com o resultado).
 * Idempotente pelo par único (votingId, parliamentarianId): re-execuções do
 * comando de fechamento preservam o recibo original (upsert sem regravação).
 * Auditoria `voting.receipts_issued` na mesma transação.
 */
export async function issueVoteReceipts(
  tx: Prisma.TransactionClient,
  args: IssueReceiptsArgs
): Promise<number> {
  if (args.votes.length === 0) return 0

  const closedAtIso = args.closedAt.toISOString()
  const secret = args.mode === 'secreto'
  for (const vote of args.votes) {
    const valueForReceipt = secret ? SECRET_VOTE_PLACEHOLDER : vote.value
    const { code, hash } = computeReceipt(
      args.tenantId,
      args.votingId,
      vote.parliamentarianId,
      valueForReceipt,
      closedAtIso
    )
    await tx.voteReceipt.upsert({
      where: {
        votingId_parliamentarianId: {
          votingId: args.votingId,
          parliamentarianId: vote.parliamentarianId,
        },
      },
      create: {
        votingId: args.votingId,
        parliamentarianId: vote.parliamentarianId,
        receiptCode: code,
        payloadHash: hash,
        issuedAt: args.closedAt,
      },
      // Idempotência: recibo já emitido → preservado (nada a atualizar).
      update: {},
    })
  }

  const total = await tx.voteReceipt.count({ where: { votingId: args.votingId } })
  await writeAudit(tx, {
    tenantId: args.tenantId,
    actor: args.actor,
    action: 'voting.receipts_issued',
    aggregateType: 'voting',
    aggregateId: args.votingId,
    summary: `Recibos verificáveis emitidos para os ${total} ${total === 1 ? 'voto' : 'votos'} da votação: ${args.question.slice(0, 60)}${secret ? ' (votação secreta — recibo comprova participação, sem valor).' : '.'}`,
    after: { receiptsIssued: total, mode: args.mode, secret },
    correlationId: args.correlationId,
    ip: args.ip ?? null,
  })
  return total
}
