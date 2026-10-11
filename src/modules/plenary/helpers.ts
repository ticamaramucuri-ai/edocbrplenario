'use client'

/**
 * Helpers da Mesa do Plenário — rótulos, ordenação e seleção de votação ativa.
 * (Ownership Task 3-b: uso interno dos módulos plenary/display.)
 */

import type {
  AgendaItemView,
  SessionDetail,
  SessionStatus,
  SessionSummary,
  SpeechView,
  VotingView,
} from '@/lib/contracts'
import { SESSION_TYPE_LABEL } from '@/lib/contracts'
import type { DisplayProfile } from '@/modules/display/profiles'

/** Status em que a sessão está "ao vivo" (credenciamento até encerramento). */
export const LIVE_SESSION_STATUSES: SessionStatus[] = ['check_in', 'open', 'suspended', 'resumed']

/** Status que permitem criar votação (regra da API). */
export const VOTING_CREATION_STATUSES: SessionStatus[] = ['open', 'suspended', 'resumed']

/** Status que permitem adicionar matérias à pauta (regra da API). */
export const AGENDA_EDIT_STATUSES: SessionStatus[] = ['draft', 'scheduled', 'check_in']

/** Status que permitem enfileirar discursos (regra da API). */
export const SPEECH_STATUSES: SessionStatus[] = ['check_in', 'open', 'suspended', 'resumed']

/** Ações de presença ao vivo (check_in/check_out/return) — API exige sessão ao vivo. */
export function attendanceLiveAllowed(status: SessionStatus): boolean {
  return LIVE_SESSION_STATUSES.includes(status)
}

/** Marcações manuais (mark_*) — API permite apenas em scheduled|check_in. */
export function attendanceMarkAllowed(status: SessionStatus): boolean {
  return status === 'scheduled' || status === 'check_in'
}

export function sessionLabel(s: Pick<SessionSummary, 'type' | 'number' | 'year'>): string {
  return `${SESSION_TYPE_LABEL[s.type] ?? s.type} nº ${s.number}/${s.year}`
}

/** Ordenação do seletor de sessões: ao vivo → agendadas → encerradas → demais. */
export function sortSessionsForPicker(sessions: SessionSummary[]): SessionSummary[] {
  const rank = (s: SessionSummary): number => {
    if (LIVE_SESSION_STATUSES.includes(s.status)) return 0
    if (s.status === 'scheduled') return 1
    if (s.status === 'closed') return 2
    if (s.status === 'draft') return 3
    return 4 // cancelled
  }
  return [...sessions].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    const da = new Date(a.scheduledAt).getTime()
    const db = new Date(b.scheduledAt).getTime()
    // Ao vivo/agendadas: a mais próxima primeiro; encerradas: a mais recente primeiro.
    return ra <= 1 ? da - db : db - da
  })
}

/**
 * Votação em foco: a mais recente com status ready|open|paused;
 * se nenhuma, a última encerrada (para exibir o resultado).
 */
export function pickActiveVoting(votings: VotingView[]): VotingView | null {
  for (let i = votings.length - 1; i >= 0; i -= 1) {
    const v = votings[i]
    if (v.status === 'ready' || v.status === 'open' || v.status === 'paused') return v
  }
  for (let i = votings.length - 1; i >= 0; i -= 1) {
    if (votings[i].status === 'closed') return votings[i]
  }
  return null
}

/** Perfil automático do telão a partir do estado interno da sessão. */
export function autoDisplayProfile(data: SessionDetail): DisplayProfile {
  const voting = pickActiveVoting(data.votings)
  if (voting && (voting.status === 'open' || voting.status === 'paused')) return 'votacao'
  if (data.speeches.some((s) => s.status === 'falando' || s.status === 'pausado')) return 'discurso'
  if (data.session.status === 'check_in') return 'presenca'
  if (data.session.status === 'closed' || data.session.status === 'cancelled') return 'encerramento'
  return 'pauta'
}

/** Discurso no palco (primeiro falando|pausado) e fila de oradores. */
export function speechStage(speeches: SpeechView[]): SpeechView | null {
  return speeches.find((s) => s.status === 'falando' || s.status === 'pausado') ?? null
}

export const AGENDA_SECTIONS: Array<{ key: AgendaItemView['section']; label: string }> = [
  { key: 'expediente', label: 'Expediente' },
  { key: 'ordem_do_dia', label: 'Ordem do Dia' },
  { key: 'comunicacoes', label: 'Comunicações' },
]

/** Cor do resumo do item de pauta (suave: sucesso/erro/neutro). */
export function resultSummaryClass(item: AgendaItemView): string {
  if (item.status === 'aprovado') return 'text-emerald-700 dark:text-emerald-400'
  if (item.status === 'rejeitado') return 'text-rose-700 dark:text-rose-400'
  if (item.status === 'retirado' || item.status === 'adiado') return 'text-muted-foreground'
  return 'text-muted-foreground'
}
