/**
 * Lógica de domínio pura (ADR-002): máquinas de estado, quórum e cálculo
 * determinístico de resultados de votação.
 */
import type {
  AttendanceRow,
  AttendanceStatus,
  QuorumInfo,
  ResultCounts,
  SessionStatus,
  TenantSettings,
  VoteValue,
  VotingRule,
  VotingStatus,
} from '@/lib/contracts'
import type { Prisma, PrismaClient } from '@prisma/client'
import { DomainError } from './errors'

type Tx = Prisma.TransactionClient | PrismaClient

// ─── Máquina de estados da Sessão ───────────────────────────────────────────

export type SessionAction =
  | 'schedule'
  | 'open_checkin'
  | 'open_session'
  | 'suspend'
  | 'resume'
  | 'close'
  | 'cancel'

export type SessionTransition = {
  from: SessionStatus[]
  to: SessionStatus
  /** Pré-condições validadas pela rota (ex.: pauta, presidente, justificativa). */
  requires: Array<'agenda' | 'president' | 'justification'>
}

export const SESSION_TRANSITIONS: Record<SessionAction, SessionTransition> = {
  schedule: { from: ['draft'], to: 'scheduled', requires: ['agenda'] },
  open_checkin: { from: ['scheduled'], to: 'check_in', requires: [] },
  open_session: { from: ['check_in'], to: 'open', requires: ['president'] },
  suspend: { from: ['open', 'resumed'], to: 'suspended', requires: [] },
  resume: { from: ['suspended'], to: 'resumed', requires: [] },
  close: { from: ['open', 'suspended', 'resumed'], to: 'closed', requires: [] },
  cancel: { from: ['draft', 'scheduled', 'check_in'], to: 'cancelled', requires: ['justification'] },
}

// ─── Máquina de estados da Votação ──────────────────────────────────────────

export type VotingAction = 'open' | 'pause' | 'resume' | 'close' | 'annul'

export type VotingTransition = {
  from: VotingStatus[]
  to: VotingStatus
  requires: Array<'justification'>
}

export const VOTING_TRANSITIONS: Record<VotingAction, VotingTransition> = {
  open: { from: ['ready', 'paused'], to: 'open', requires: [] },
  pause: { from: ['open'], to: 'paused', requires: [] },
  resume: { from: ['paused'], to: 'open', requires: [] },
  close: { from: ['open', 'paused'], to: 'closed', requires: [] },
  annul: { from: ['closed'], to: 'annulled', requires: ['justification'] },
}

// ─── Cálculo de resultado (determinístico) ──────────────────────────────────

export type ComputedResult = { resultStatus: 'aprovado' | 'rejeitado' | 'empate' | 'sem_quorum'; counts: ResultCounts }

/**
 * ADR-002 §5:
 * - sem quórum (present < required) → `sem_quorum` (antes de qualquer regra);
 * - `maioria_simples`: sim>nao→aprovado; sim<nao→rejeitado; iguais→empate;
 * - `maioria_absoluta`: sim > Math.floor(totalMembers/2) → aprovado (13 membros ⇒ ≥7 sim);
 * - `unanimidade`: nao===0 && abstencao===0 && sim>0 → aprovado senão rejeitado.
 */
export function computeVotingResult(input: {
  rule: VotingRule
  votes?: Array<{ value: VoteValue }> // nominal/secreto: votos do banco
  countsSimbolico?: { sim: number; nao: number; abstencoes: number }
  presentCount: number
  totalMembers: number
  requiredQuorum: number
}): ComputedResult {
  let sim = 0
  let nao = 0
  let abstencoes = 0
  if (input.countsSimbolico) {
    sim = input.countsSimbolico.sim
    nao = input.countsSimbolico.nao
    abstencoes = input.countsSimbolico.abstencoes
  } else {
    for (const v of input.votes ?? []) {
      if (v.value === 'sim') sim += 1
      else if (v.value === 'nao') nao += 1
      else if (v.value === 'abstencao') abstencoes += 1
    }
  }
  const present = input.presentCount
  const counts: ResultCounts = {
    sim,
    nao,
    abstencoes,
    naoRegistraram: Math.max(0, present - (sim + nao + abstencoes)),
    presentes: present,
  }

  if (present < input.requiredQuorum) {
    return { resultStatus: 'sem_quorum', counts }
  }

  let resultStatus: ComputedResult['resultStatus']
  switch (input.rule) {
    case 'maioria_absoluta':
      resultStatus = sim > Math.floor(input.totalMembers / 2) ? 'aprovado' : 'rejeitado'
      break
    case 'unanimidade':
      resultStatus = nao === 0 && abstencoes === 0 && sim > 0 ? 'aprovado' : 'rejeitado'
      break
    case 'maioria_simples':
    default:
      resultStatus = sim > nao ? 'aprovado' : sim < nao ? 'rejeitado' : 'empate'
      break
  }
  return { resultStatus, counts }
}

/** Frase-resumo no padrão do seed ("Aprovado por 9 votos sim, 1 não e 1 abstenção."). */
export function resultSummaryPhrase(resultStatus: string, counts: ResultCounts): string {
  const partes: string[] = []
  if (counts.sim) partes.push(`${counts.sim} ${counts.sim > 1 ? 'votos' : 'voto'} sim`)
  if (counts.nao) partes.push(`${counts.nao} ${counts.nao > 1 ? 'votos' : 'voto'} não`)
  if (counts.abstencoes) partes.push(`${counts.abstencoes} ${counts.abstencoes > 1 ? 'abstenções' : 'abstenção'}`)
  const join = partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
  switch (resultStatus) {
    case 'aprovado':
      return `Aprovado por ${join || 'unanimidade'}.`
    case 'rejeitado':
      return `Rejeitado por ${join || 'falta de votos a favor'}.`
    case 'empate':
      return join ? `Empate na votação (${join}).` : 'Empate na votação sem votos registrados.'
    case 'sem_quorum':
      return `Votação encerrada sem quórum (${counts.presentes} presentes).`
    default:
      return `Resultado: ${resultStatus}${join ? ` (${join})` : ''}.`
  }
}

// ─── Configurações do tenant (JSON com defaults) ────────────────────────────

export function tenantSettings(
  tenant: { settings: string },
  activeParliamentarians = 0
): TenantSettings {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = tenant.settings ? (JSON.parse(tenant.settings) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    quorumMinimum: num(parsed.quorumMinimum, Math.ceil(activeParliamentarians / 2) || 1),
    allowVoteChange: bool(parsed.allowVoteChange, true),
    speechDefaultSeconds: num(parsed.speechDefaultSeconds, 300),
    soundAlerts: bool(parsed.soundAlerts, true),
    hidePartialByDefault: bool(parsed.hidePartialByDefault, false),
    // Fase 7 — auto check-in pelo app do parlamentar (campo opcional: default true,
    // ausente nas settings existentes NÃO quebra o parse).
    allowSelfCheckIn: bool(parsed.allowSelfCheckIn, true),
    enabledSessionTypes: Array.isArray(parsed.enabledSessionTypes)
      && parsed.enabledSessionTypes.length > 0
      && parsed.enabledSessionTypes.every((v) => ['ordinaria', 'extraordinaria', 'solene', 'especial'].includes(String(v)))
      ? [...new Set(parsed.enabledSessionTypes)] as TenantSettings['enabledSessionTypes']
      : ['ordinaria', 'extraordinaria', 'solene', 'especial'],
    requireSecretaryForPublication: bool(parsed.requireSecretaryForPublication, false),
    minimumAgendaMatters: Number.isInteger(parsed.minimumAgendaMatters)
      && Number(parsed.minimumAgendaMatters) >= 0 && Number(parsed.minimumAgendaMatters) <= 100
      ? Number(parsed.minimumAgendaMatters) : 0,
    minimumNoticeHours: Number.isInteger(parsed.minimumNoticeHours)
      && Number(parsed.minimumNoticeHours) >= 0 && Number(parsed.minimumNoticeHours) <= 720
      ? Number(parsed.minimumNoticeHours) : 0,
    minimumAmendmentHours: Number.isInteger(parsed.minimumAmendmentHours)
      && Number(parsed.minimumAmendmentHours) >= 0 && Number(parsed.minimumAmendmentHours) <= 720
      ? Number(parsed.minimumAmendmentHours) : 0,
    urgentNoticeExceptionTypes: Array.isArray(parsed.urgentNoticeExceptionTypes)
      && parsed.urgentNoticeExceptionTypes.every((v) => ['ordinaria', 'extraordinaria', 'solene', 'especial'].includes(String(v)))
      ? [...new Set(parsed.urgentNoticeExceptionTypes)] as TenantSettings['urgentNoticeExceptionTypes'] : [],
    noticeAlertLeadHours: Number.isInteger(parsed.noticeAlertLeadHours)
      && Number(parsed.noticeAlertLeadHours) >= 1 && Number(parsed.noticeAlertLeadHours) <= 168
      ? Number(parsed.noticeAlertLeadHours) : 24,
    noticeRecipientPolicy: parsed.noticeRecipientPolicy === 'mandate_and_leave' ? 'mandate_and_leave' : 'active',
    votingPoliciesByMatterType: parseVotingPolicies(parsed.votingPoliciesByMatterType),
  }
}

const MATTER_TYPES = ['projeto_de_lei', 'decreto_legislativo', 'requerimento', 'indicacao', 'mocao', 'emenda'] as const
const VOTING_RULES = ['maioria_simples', 'maioria_absoluta', 'unanimidade'] as const

function parseVotingPolicies(value: unknown): TenantSettings['votingPoliciesByMatterType'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: TenantSettings['votingPoliciesByMatterType'] = {}
  for (const type of MATTER_TYPES) {
    const row = (value as Record<string, unknown>)[type]
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const policy = row as Record<string, unknown>
    if (VOTING_RULES.includes(policy.rule as typeof VOTING_RULES[number])
      && Number.isInteger(policy.quorumMinimum) && Number(policy.quorumMinimum) >= 1 && Number(policy.quorumMinimum) <= 100) {
      result[type] = { rule: policy.rule as typeof VOTING_RULES[number], quorumMinimum: Number(policy.quorumMinimum) }
    }
  }
  return result
}

/** Valida prazo de convocação/retificação e eventual exceção autorizada pela Câmara. */
export function enforceNoticeDeadline(input: {
  settings: TenantSettings
  sessionType: string
  scheduledAt: Date
  now: Date
  phase: 'initial' | 'amendment'
  exceptionReason?: string
}) {
  const minimumHours = input.phase === 'initial' ? input.settings.minimumNoticeHours : input.settings.minimumAmendmentHours
  if (input.scheduledAt.getTime() <= input.now.getTime()) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Sessão já iniciada', 'A data marcada da sessão deve estar no futuro para publicar ou retificar a convocação.')
  }
  const insufficient = input.scheduledAt.getTime() - input.now.getTime() < minimumHours * 60 * 60 * 1000
  const reason = input.exceptionReason?.trim()
  if (reason && !insufficient) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Exceção desnecessária', 'A exceção só pode ser usada quando o prazo mínimo não é atendido.')
  }
  if (insufficient && (!reason || !input.settings.urgentNoticeExceptionTypes.includes(input.sessionType as TenantSettings['urgentNoticeExceptionTypes'][number]))) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Prazo de convocação',
      `Esta Câmara exige ${minimumHours} hora(s) de antecedência para ${input.phase === 'initial' ? 'publicar' : 'retificar'} a convocação. Exceção indisponível ou sem justificativa para este tipo de sessão.`)
  }
  return { minimumHours, exceptionReason: reason ?? null }
}

// ─── Presença derivada (append-only → estado atual) ─────────────────────────

export type AttendanceParliamentarian = {
  id: string
  name: string
  party: string
  bloc: string | null
  boardRole: string
  photoUrl: string | null
  order: number
}

export type AttendanceEventLite = {
  parliamentarianId: string
  status: string
  createdAt: Date
}

/** Estado atual por parlamentar = último AttendanceEvent dele na sessão. */
export function deriveAttendance(
  parliamentarians: AttendanceParliamentarian[],
  events: AttendanceEventLite[]
): { rows: AttendanceRow[]; statuses: Map<string, AttendanceStatus>; present: number } {
  const lastByParl = new Map<string, AttendanceEventLite>()
  for (const ev of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    lastByParl.set(ev.parliamentarianId, ev)
  }
  const statuses = new Map<string, AttendanceStatus>()
  const rows: AttendanceRow[] = parliamentarians.map((p) => {
    const last = lastByParl.get(p.id)
    const status: AttendanceStatus = (last?.status as AttendanceStatus) ?? 'ausente'
    statuses.set(p.id, status)
    return {
      parliamentarianId: p.id,
      name: p.name,
      party: p.party,
      bloc: p.bloc,
      boardRole: p.boardRole,
      photoUrl: p.photoUrl,
      status,
      present: status === 'presente',
      lastEventAt: last ? last.createdAt.toISOString() : null,
    }
  })
  const present = parliamentarians.filter((p) => statuses.get(p.id) === 'presente').length
  return { rows, statuses, present }
}

/** Consulta completa de presença + quórum de uma sessão. */
export async function currentAttendance(
  client: Tx,
  sessionId: string,
  tenantId: string
): Promise<{ rows: AttendanceRow[]; statuses: Map<string, AttendanceStatus>; quorum: QuorumInfo }> {
  const [tenant, parliamentarians, events] = await Promise.all([
    client.tenant.findUnique({ where: { id: tenantId } }),
    client.parliamentarian.findMany({
      where: { tenantId, active: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }),
    client.attendanceEvent.findMany({ where: { sessionId } }),
  ])
  const settings = tenantSettings(tenant ?? { settings: '{}' }, parliamentarians.length)
  const { rows, statuses, present } = deriveAttendance(parliamentarians, events)
  const required = settings.quorumMinimum
  return {
    rows,
    statuses,
    quorum: { present, total: parliamentarians.length, required, ok: present >= required },
  }
}

// ─── Máquina de estados da Matéria (Fase 5 — tramitação) ────────────────────

export type MatterStatusValue =
  | 'em_tramitacao'
  | 'incluida_pauta'
  | 'aprovado'
  | 'rejeitado'
  | 'retirado'
  | 'arquivado'
  | 'sancionado'
  | 'vetado'

/**
 * Transições válidas de situação da matéria. `aprovado`, `rejeitado`,
 * `retirado`, `sancionado` e `vetado` são TERMINAIS (mudança apenas via
 * anulação formal de sessão — fora de escopo; `sancionado`/`vetado` saem de
 * `aprovado` EXCLUSIVAMENTE via POST /matters/:id/outcomes, Fase 17).
 * Toda mudança de status ocorre EXCLUSIVAMENTE via POST
 * /api/v1/matters/:id/proceedings (timeline append-only) ou outcome.
 */
export const MATTER_STATUS_TRANSITIONS: Record<MatterStatusValue, MatterStatusValue[]> = {
  em_tramitacao: ['incluida_pauta', 'arquivado', 'retirado'],
  incluida_pauta: ['aprovado', 'rejeitado', 'retirado', 'em_tramitacao'],
  arquivado: ['em_tramitacao'],
  aprovado: [],
  rejeitado: [],
  retirado: [],
  sancionado: [],
  vetado: [],
}

export const MATTER_TERMINAL_STATUSES: MatterStatusValue[] = [
  'aprovado',
  'rejeitado',
  'retirado',
  'sancionado',
  'vetado',
]

/** Ações de tramitação que alteram a situação da matéria (novelty check). */
export const PROCEEDING_ACTIONS = [
  'despacho',
  'parecer',
  'emenda',
  'inclusao_pauta',
  'sessao',
  'sanco',
  'veto',
  'arquivamento',
  'desarquivamento',
  'outro',
] as const

export type ProceedingAction = (typeof PROCEEDING_ACTIONS)[number]

/**
 * Valida o andamento contra a máquina de estados:
 * - matéria em status terminal → nunca aceita novo andamento;
 * - `toStatus === status atual` → andamento informativo (parecer, despacho…);
 * - `toStatus` ∈ MATTER_STATUS_TRANSITIONS[status atual] → transição válida.
 * Lança MATTER_INVALID_TRANSITION (409) quando inválido.
 */
export function assertProceedingTransition(
  current: MatterStatusValue,
  toStatus: MatterStatusValue
): void {
  if (MATTER_TERMINAL_STATUSES.includes(current)) {
    throw new DomainError(
      'MATTER_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Matéria em situação terminal ("${current}") — novos andamentos exigem anulação formal de sessão.`
    )
  }
  const allowed = MATTER_STATUS_TRANSITIONS[current]
  if (toStatus !== current && !allowed.includes(toStatus)) {
    throw new DomainError(
      'MATTER_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Transição de situação "${current}" → "${toStatus}" não é permitida. Situações válidas a partir da atual: ${[
        current,
        ...allowed,
      ].join(', ')}.`
    )
  }
}
