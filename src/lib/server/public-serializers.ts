/**
 * Serializadores públicos (Fase 6) — linhas do banco → views PUBLICÁVEIS
 * (docs/api-contract.md §Fase 6). Regra de sigilo invariável: votação SECRETA
 * jamais expõe detalhe nominal (nominalDetail: null).
 */
import type {
  MatterPublicView,
  PublicMatterDetail,
  PublicSessionDetail,
  PublicSessionSummary,
  VoteValueOrEmpty,
} from '@/lib/contracts'
import type {
  AgendaItem as AgendaItemRow,
  LegislativeMatter as MatterRow,
  Proceeding as ProceedingRow,
  Session as SessionRow,
  Speech as SpeechRow,
  Voting as VotingRow,
} from '@prisma/client'
import {
  parseAuthors,
  parseNominalDetail,
  parseResultCounts,
  speechElapsedSeconds,
} from './serializers'

export function toMatterPublicView(m: MatterRow): MatterPublicView {
  return {
    id: m.id,
    type: m.type as MatterPublicView['type'],
    number: m.number,
    year: m.year,
    ementa: m.ementa,
    authors: parseAuthors(m.authors),
    status: m.status as MatterPublicView['status'],
    regime: m.regime as MatterPublicView['regime'],
    createdAt: m.createdAt.toISOString(),
  }
}

export function toPublicSessionSummary(s: SessionRow): PublicSessionSummary {
  return {
    id: s.id,
    number: s.number,
    year: s.year,
    type: s.type as PublicSessionSummary['type'],
    scheduledAt: s.scheduledAt.toISOString(),
    status: s.status as PublicSessionSummary['status'],
    agendaPublished: s.agendaPublished,
  }
}

export type PublicAgendaItem = {
  id: string
  order: number
  section: 'expediente' | 'ordem_do_dia' | 'comunicacoes'
  title: string
  status: string
  resultSummary: string | null
}

export function toPublicAgendaItem(item: AgendaItemRow): PublicAgendaItem {
  return {
    id: item.id,
    order: item.order,
    section: item.section as PublicAgendaItem['section'],
    title: item.title,
    status: item.status,
    resultSummary: item.resultSummary ?? null,
  }
}

/**
 * Detalhe nominal público de uma votação encerrada: apenas quando o modo NÃO
 * é secreto. Partido resolvido pelo mapa de parlamentares.
 */
export function publicNominalDetail(
  voting: VotingRow,
  partyById: Map<string, string>
): Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null {
  if (voting.mode === 'secreto') return null
  const detail = parseNominalDetail(voting.resultDetail)
  if (!detail) return null
  return detail.map((d) => ({
    name: d.name,
    party: partyById.get(d.parliamentarianId) ?? '',
    value: d.value,
  }))
}

export function toPublicVotingResult(
  voting: VotingRow,
  partyById: Map<string, string>,
  impedimentCount = 0
): PublicSessionDetail['votings'][number] {
  return {
    id: voting.id,
    question: voting.question,
    mode: voting.mode as 'nominal' | 'simbolico' | 'secreto',
    resultStatus: voting.resultStatus ?? null,
    resultCounts: parseResultCounts(voting.resultCounts),
    closedAt: voting.closedAt ? voting.closedAt.toISOString() : null,
    nominalDetail: voting.status === 'closed' ? publicNominalDetail(voting, partyById) : null,
    votingBasis: {
      presentAtOpen: voting.presentAtOpen,
      presentAtClose: voting.presentAtClose,
      requiredQuorum: voting.quorumAtOpen ?? voting.requiredQuorum,
      memberBaseAtOpen: voting.memberBaseAtOpen,
      impedimentPolicyAtOpen: voting.impedimentPolicyAtOpen === 'retain_base' || voting.impedimentPolicyAtOpen === 'reduce_base'
        ? voting.impedimentPolicyAtOpen : null,
      impedimentCount,
    },
  }
}

/** Última votação com resultado da matéria (ou null). */
export function toPublicMatterDetail(
  matter: MatterRow,
  proceedings: ProceedingRow[],
  lastVoting: VotingRow | null,
  versions: Array<{ version: number; authorName: string; createdAt: Date }>,
  partyById: Map<string, string>
): PublicMatterDetail {
  return {
    matter: toMatterPublicView(matter),
    proceedings: proceedings.map((p) => ({
      seq: p.seq,
      action: p.action,
      toStatus: p.toStatus,
      createdAt: p.createdAt.toISOString(),
    })),
    lastVoting:
      lastVoting && lastVoting.resultStatus
        ? {
            id: lastVoting.id,
            question: lastVoting.question,
            mode: lastVoting.mode as 'nominal' | 'simbolico' | 'secreto',
            resultStatus: lastVoting.resultStatus,
            resultCounts: parseResultCounts(lastVoting.resultCounts),
            closedAt: lastVoting.closedAt ? lastVoting.closedAt.toISOString() : null,
            nominalDetail: publicNominalDetail(lastVoting, partyById),
          }
        : null,
    versions: versions
      .slice()
      .sort((a, b) => a.version - b.version)
      .map((v) => ({
        version: v.version,
        authorName: v.authorName,
        createdAt: v.createdAt.toISOString(),
      })),
  }
}

/** Discurso público encerrado: orador, assunto e duração. */
export function toPublicSpeech(
  speech: SpeechRow & { parliamentarian?: { name: string } | null }
): PublicSessionDetail['speeches'][number] {
  return {
    speakerName: speech.parliamentarian?.name ?? speech.externalSpeaker ?? 'Orador externo',
    kind: speech.kind,
    subject: speech.subject ?? null,
    durationSeconds: speechElapsedSeconds(speech),
  }
}
