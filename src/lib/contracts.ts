/**
 * Contratos compartilhados Legis SaaS — fonte única de verdade entre API e frontend.
 * Ver docs/adr/ e docs/api-contract.md
 */

// ─── Tipos base ─────────────────────────────────────────────────────────────

export type Role =
  | 'platform_owner'
  | 'platform_support'
  | 'tenant_admin'
  | 'legislative_admin'
  | 'session_operator'
  | 'media_operator'
  | 'presiding_officer'
  | 'parliamentarian'
  | 'auditor'

export type SessionStatus =
  | 'draft'
  | 'scheduled'
  | 'check_in'
  | 'open'
  | 'suspended'
  | 'resumed'
  | 'closed'
  | 'cancelled'

/** Acompanhamento da fonte local; não representa status de plataformas sociais. */
export type TransmissionView = {
  transmission: {
    id: string | null
    sessionId: string
    status: 'draft' | 'ready' | 'monitoring' | 'ended'
    effectiveStatus: 'draft' | 'ready' | 'monitoring' | 'signal_lost' | 'ended'
    version: number
    startedAt: string | null
    endedAt: string | null
  }
  source: {
    configured: boolean
    ready: boolean
    path: string
    checkedAt: string
    inboundBytes: number | null
    error: string | null
  }
  replayed?: boolean
}

/** Estado de transporte do MediaMTX, sem confirmação da plataforma social. */
export type MediaDestinationsView = {
  configured: boolean
  controllerAvailable: boolean
  controllerErrorCode: string | null
  destinations: Array<{
    id: string
    label: string
    platform: 'youtube' | 'facebook' | 'instagram' | 'other'
    enabled: boolean | null
    state: 'disabled' | 'idle' | 'forwarding' | 'error' | 'unknown'
    outboundBytes: number | null
    desiredEnabled: boolean
    syncStatus: 'unmanaged' | 'pending' | 'applied' | 'error'
    lastErrorCode: string | null
  }>
  changed?: boolean
}

export type MediaRecordingView = {
  configured: boolean
  segmentCount: number
  latestSegmentAt: string | null
}

export type VotingStatus = 'draft' | 'ready' | 'open' | 'paused' | 'closed' | 'annulled'
export type VotingMode = 'nominal' | 'simbolico' | 'secreto'
export type VotingRule = 'maioria_simples' | 'maioria_absoluta' | 'unanimidade'
export type VoteValue = 'sim' | 'nao' | 'abstencao'
export type VoteValueOrEmpty = VoteValue | 'nao_registrado'
export type AttendanceStatus = 'presente' | 'saida_temporaria' | 'licenciado' | 'afastado' | 'ausente'
export type AgendaItemStatus =
  | 'pendente'
  | 'em_leitura'
  | 'em_discussao'
  | 'em_votacao'
  | 'aprovado'
  | 'rejeitado'
  | 'retirado'
  | 'adiado'
export type SpeechStatus = 'fila' | 'falando' | 'pausado' | 'encerrado'
export type MatterStatus =
  | 'em_tramitacao'
  | 'incluida_pauta'
  | 'aprovado'
  | 'rejeitado'
  | 'retirado'
  | 'arquivado'
  | 'sancionado'
  | 'vetado'
export type MatterType = 'projeto_de_lei' | 'decreto_legislativo' | 'requerimento' | 'indicacao' | 'mocao' | 'emenda'
export type SessionType = 'ordinaria' | 'extraordinaria' | 'solene' | 'especial'
export type NoticeRecipientPolicy = 'active' | 'mandate_and_leave'

export type TenantSettings = {
  quorumMinimum: number
  allowVoteChange: boolean
  speechDefaultSeconds: number
  soundAlerts: boolean
  hidePartialByDefault: boolean
  /** Fase 7 — auto check-in pelo app do parlamentar (opcional, default true). */
  allowSelfCheckIn?: boolean
  /** Política inicial de preparação, configurada individualmente por Câmara. */
  enabledSessionTypes: SessionType[]
  requireSecretaryForPublication: boolean
  minimumAgendaMatters: number
  minimumNoticeHours: number
  minimumAmendmentHours: number
  urgentNoticeExceptionTypes: SessionType[]
  noticeAlertLeadHours: number
  noticeRecipientPolicy: NoticeRecipientPolicy
}

export type TenantView = {
  id: string
  slug: string
  name: string
  city: string
  uf: string
  plan: string
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  timezone: string
  settings: TenantSettings
  trialEndsAt: string | null // Onda 5/F24: banner de trial no topbar
}

export type ActorView = {
  id: string
  name: string
  role: Role
  jobTitle: string | null
  parliamentarianId: string | null
  /** Onda 4/Fase 20 — banner de impersonação ativa (presente quando o ator é um
   * alvo de suporte operando via sessão autenticada; ver /api/v1/auth/me). */
  impersonation?: ImpersonationBannerView | null
}

// ─── Sessões ────────────────────────────────────────────────────────────────

export type SessionSummary = {
  id: string
  number: number
  year: number
  type: SessionType
  scheduledAt: string
  openedAt: string | null
  closedAt: string | null
  status: SessionStatus
  presidentName: string | null
  presidentId: string | null
  secretaryName: string | null
  location: string
  agendaPublished: boolean
  agendaCount: number
  presentCount: number
  totalMembers: number
  version: number
  notes: string | null
}

export type AgendaItemView = {
  id: string
  order: number
  section: 'expediente' | 'ordem_do_dia' | 'comunicacoes'
  title: string
  matterId: string | null
  matterLabel: string | null
  kind: 'individual' | 'lote'
  status: AgendaItemStatus
  resultSummary: string | null
}

export type AttendanceRow = {
  parliamentarianId: string
  name: string
  party: string
  bloc: string | null
  boardRole: string
  photoUrl: string | null
  status: AttendanceStatus
  present: boolean
  lastEventAt: string | null
}

export type QuorumInfo = {
  present: number
  total: number
  required: number
  ok: boolean
}

export type VoteRow = {
  parliamentarianId: string
  name: string
  party: string
  /** null quando votação secreta (participação revelada, valor jamais); Onda 4: também aceita chaves de VotingOption customizadas */
  value: VoteValue | 'nao_registrado' | string | null
  receivedAt: string | null
  changedAt: string | null
}

export type ResultCounts = {
  sim: number
  nao: number
  abstencoes: number
  naoRegistraram: number
  presentes: number
  /** Onda 4/Fase 18: contagem por chave de opção customizada (presente apenas quando a votação as define) */
  custom?: Record<string, number>
}

export type VotingView = {
  id: string
  sessionId: string
  agendaItemId: string | null
  matterId: string | null
  question: string
  mode: VotingMode
  status: VotingStatus
  rule: VotingRule
  openedAt: string | null
  closedAt: string | null
  hidePartial: boolean
  options?: VotingOptionView[] // Onda 4/Fase 18: opções customizadas (vazio = padrão)
  presentAtOpen: number | null
  presentAtClose: number | null
  resultStatus: 'aprovado' | 'rejeitado' | 'empate' | 'sem_quorum' | 'anulado' | null
  resultCounts: ResultCounts | null
  votes: VoteRow[] | null // votação secreta: value null por linha (participação sem valor)
  registeredCount: number
  version: number
  justification: string | null
}

export type SpeechView = {
  id: string
  sessionId: string
  speakerName: string
  parliamentarianId: string | null
  kind: string
  subject: string | null
  side: 'situacao' | 'oposicao' | 'neutro' | null
  status: SpeechStatus
  plannedSeconds: number
  elapsedSeconds: number
  startedAt: string | null
  pausedAt: string | null
  finishedAt: string | null
}

export type SessionDetail = {
  session: SessionSummary
  agenda: AgendaItemView[]
  attendance: AttendanceRow[]
  quorum: QuorumInfo
  votings: VotingView[]
  speeches: SpeechView[]
}

// ─── Matérias / parlamentares / auditoria ───────────────────────────────────

export type MatterView = {
  id: string
  type: MatterType
  number: number
  year: number
  ementa: string
  authors: string[]
  status: MatterStatus
  regime: 'ordinario' | 'urgencia'
  createdAt: string
}

export type ParliamentarianView = {
  id: string
  name: string
  party: string
  bloc: string | null
  boardRole: string
  committee: string | null
  email: string | null
  phone: string | null
  active: boolean
}

export type AuditView = {
  id: string
  actorName: string
  actorRole: string
  action: string
  aggregateType: string
  aggregateId: string | null
  summary: string
  beforeValue: string | null
  afterValue: string | null
  justification: string | null
  correlationId: string | null
  ip: string | null
  createdAt: string
  chainHash: string
  prevHash: string | null
}

export type BootstrapView = {
  tenant: TenantView
  demoMode: boolean
  actors: ActorView[]
  counts: { parliamentarians: number; matters: number; sessions: number }
  nextSession: SessionSummary | null
  liveSession: SessionSummary | null
}

export type ReportView = {
  tenant: TenantView
  session: SessionDetail
  auditChain: { events: number; valid: boolean; head: string | null }
  verificationCode: string
}

export type PublicLiveView = {
  tenant: { name: string; city: string; uf: string; primaryColor: string; accentColor: string; logoUrl: string | null }
  session: {
    id: string
    label: string
    status: SessionStatus
    statusLabel: string
    scheduledAt: string | null
    presidentName: string | null
    presentCount: number
    totalMembers: number
    requiredQuorum: number
  } | null
  presentMembers: Array<{ name: string; party: string }>
  agenda: Array<Pick<AgendaItemView, 'id' | 'order' | 'section' | 'title' | 'status' | 'resultSummary'>>
  currentVoting: {
    id: string
    question: string
    mode: VotingMode
    status: VotingStatus
    registeredCount: number
    hidePartial: boolean
    resultStatus: string | null
    resultCounts: ResultCounts | null
    nominalDetail: Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null
  } | null
  lastResults: Array<{
    id: string
    question: string
    resultStatus: string | null
    resultCounts: ResultCounts | null
    closedAt: string | null
    nominalDetail: Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null
  }>
  speakingNow: { speakerName: string; subject: string | null; plannedSeconds: number; elapsedSeconds: number; status: SpeechStatus } | null
}

// ─── Erros (Problem Details) ────────────────────────────────────────────────

export type ApiError = {
  type: string
  title: string
  status: number
  detail: string
  code: string
  correlationId: string
  errors?: Record<string, string[]>
}

// ─── Tempo real (envelope do prompt mestre) ────────────────────────────────

export type RealtimeEvent<T = Record<string, unknown>> = {
  eventId: string
  eventType: string
  schemaVersion: number
  tenantId: string
  sessionId?: string
  aggregateId: string
  aggregateVersion: number
  occurredAt: string
  origin: 'cloud' | 'edge' | 'pwa' | 'operator' | 'integration'
  correlationId: string
  payload: T
}

export type RealtimeEventType =
  | 'session.state_changed'
  | 'session.quorum'
  | 'attendance.changed'
  | 'agenda.updated'
  | 'voting.created'
  | 'voting.state_changed'
  | 'vote.recorded'
  | 'voting.result'
  | 'speech.state_changed'
  | 'display.command'
  | 'transmission.state_changed'
  // Fase 5 — estrutura institucional & processo legislativo
  | 'structure.changed'
  | 'matter.proceeding'
  | 'matter.status_changed'
  | 'protocol.registered'
  | 'task.changed'
  // Fase 6 — notificações
  | 'notification.new'
  // Fase 7 — IA assistiva (interno; artefato é sempre rascunho até revisão)
  | 'ai.artifact'
  // Fase 10 — faturamento do SaaS (interno, escopo plataforma)
  | 'billing.invoice_created'
  | 'billing.invoice_paid'
  | 'billing.invoice_overdue'
  // Fase 11 — publicações oficiais e participação popular
  | 'publication.published'
  | 'publication.revoked'
  | 'hearing.state_changed'
  | 'hearing.question_approved'

export type DisplayCommandPayload = {
  action: 'freeze' | 'unfreeze' | 'clear' | 'publish' | 'profile'
  profile?: 'boas_vindas' | 'presenca' | 'pauta' | 'votacao' | 'discurso' | 'encerramento'
}

// ─── Helpers de rótulos (pt-BR) ────────────────────────────────────────────

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  check_in: 'Credenciamento',
  open: 'Aberta',
  suspended: 'Suspensa',
  resumed: 'Retomada',
  closed: 'Encerrada',
  cancelled: 'Cancelada',
}

export const VOTING_STATUS_LABEL: Record<VotingStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronta',
  open: 'Aberta',
  paused: 'Pausada',
  closed: 'Encerrada',
  annulled: 'Anulada',
}

export const AGENDA_STATUS_LABEL: Record<AgendaItemStatus, string> = {
  pendente: 'Pendente',
  em_leitura: 'Em leitura',
  em_discussao: 'Em discussão',
  em_votacao: 'Em votação',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  retirado: 'Retirado',
  adiado: 'Adiado',
}

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  presente: 'Presente',
  saida_temporaria: 'Saída temporária',
  licenciado: 'Licenciado',
  afastado: 'Afastado',
  ausente: 'Ausente',
}

export const VOTE_VALUE_LABEL: Record<VoteValueOrEmpty, string> = {
  sim: 'Sim',
  nao: 'Não',
  abstencao: 'Abstenção',
  nao_registrado: 'Não registrou',
}

export const MATTER_TYPE_LABEL: Record<MatterType, string> = {
  projeto_de_lei: 'Projeto de Lei',
  decreto_legislativo: 'Decreto Legislativo',
  requerimento: 'Requerimento',
  indicacao: 'Indicação',
  mocao: 'Moção',
  emenda: 'Emenda',
}

export const MATTER_TYPE_SHORT: Record<MatterType, string> = {
  projeto_de_lei: 'PL',
  decreto_legislativo: 'DL',
  requerimento: 'REQ',
  indicacao: 'IND',
  mocao: 'MO',
  emenda: 'EMD',
}

export const MATTER_STATUS_LABEL: Record<MatterStatus, string> = {
  em_tramitacao: 'Em tramitação',
  incluida_pauta: 'Incluída em pauta',
  aprovado: 'Aprovada',
  rejeitado: 'Rejeitada',
  retirado: 'Retirada',
  arquivado: 'Arquivada',
  sancionado: 'Sancionada',
  vetado: 'Vetada',
}

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  ordinaria: 'Ordinária',
  extraordinaria: 'Extraordinária',
  solene: 'Solene',
  especial: 'Especial',
}

export const VOTING_MODE_LABEL: Record<VotingMode, string> = {
  nominal: 'Nominal',
  simbolico: 'Simbólica',
  secreto: 'Secreta',
}

export const VOTING_RULE_LABEL: Record<VotingRule, string> = {
  maioria_simples: 'Maioria simples',
  maioria_absoluta: 'Maioria absoluta',
  unanimidade: 'Unanimidade',
}

export const RESULT_STATUS_LABEL: Record<string, string> = {
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  empate: 'Empate',
  sem_quorum: 'Sem quórum',
  anulado: 'Anulado',
}

export const SPEECH_KIND_LABEL: Record<string, string> = {
  grande_expediente: 'Grande Expediente',
  explicacoes_pessoais: 'Explicações Pessoais',
  consideracoes_finais: 'Considerações Finais',
  homenagem: 'Homenagem',
  ordem: 'Questão de Ordem',
}

export const BOARD_ROLE_LABEL: Record<string, string> = {
  presidente: 'Presidente',
  vice_presidente: 'Vice-Presidente',
  primeiro_secretario: '1º Secretário',
  segundo_secretario: '2º Secretário',
  vereador: 'Vereador(a)',
}

export const ROLE_LABEL: Record<Role, string> = {
  platform_owner: 'Operador da Plataforma',
  platform_support: 'Suporte da Plataforma',
  tenant_admin: 'Administrador da Câmara',
  legislative_admin: 'Administração Legislativa',
  session_operator: 'Operador de Sessão',
  media_operator: 'Operador Audiovisual',
  presiding_officer: 'Presidência',
  parliamentarian: 'Parlamentar',
  auditor: 'Auditor',
}

// ─── Fase 5: Estrutura institucional & processo legislativo ─────────────────

export type LegislatureView = {
  id: string
  number: number
  startYear: number
  endYear: number
  current: boolean
}

export type PartyView = {
  id: string
  acronym: string
  name: string
  number: number | null
  active: boolean
}

export type BlocView = {
  id: string
  name: string
  partyAcronyms: string[]
  active: boolean
}

export type BoardPositionView = {
  id: string
  legislatureId: string
  legislatureNumber: number
  role: string // presidente|vice_presidente|primeiro_secretario|segundo_secretario
  parliamentarianId: string
  parliamentarianName: string
  parliamentarianParty: string
  startDate: string
  endDate: string | null
  current: boolean
}

export type CommitteeView = {
  id: string
  name: string
  acronym: string
  kind: string // permanente|temporaria|especial
  description: string | null
  active: boolean
  activeMemberCount: number
}

export type CommitteeMemberView = {
  id: string
  committeeId: string
  parliamentarianId: string
  parliamentarianName: string
  parliamentarianParty: string
  role: string // presidente|vice|relator|titular|suplente
  startDate: string
  endDate: string | null
  current: boolean
}

export type CommitteeMeetingView = {
  id: string
  committeeId: string
  committeeAcronym: string
  scheduledAt: string
  subject: string
  status: string // agendada|realizada|cancelada
  notes: string | null
}

export type LeaveView = {
  id: string
  parliamentarianId: string
  parliamentarianName: string
  kind: string // licenca|afastamento|suplencia
  startDate: string
  endDate: string | null
  reason: string
  substituteId: string | null
  substituteName: string | null
  current: boolean
}

export type MandateView = {
  id: string
  parliamentarianId: string
  parliamentarianName: string
  parliamentarianParty: string
  legislatureId: string
  legislatureNumber: number
  startDate: string
  endDate: string | null
  votes: number | null
}

export type MatterTypeConfigView = {
  id: string
  code: string
  name: string
  defaultRegime: string
  active: boolean
}

export type ProceedingView = {
  id: string
  matterId: string
  seq: number
  action: string
  fromStatus: string
  toStatus: string
  actorName: string
  actorRole: string
  notes: string | null
  documentRef: string | null
  dueAt: string | null
  createdAt: string
}

export type MatterVersionView = {
  id: string
  matterId: string
  version: number
  text: string
  authorName: string
  createdAt: string
}

export type MatterAttachmentView = {
  id: string
  matterId: string
  name: string
  kind: string
  sizeBytes: number
  url: string | null
  createdAt: string
}

export type ProtocolEntryView = {
  id: string
  number: number
  year: number
  kind: string
  senderName: string
  subject: string
  matterId: string | null
  status: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type LegislativeTaskView = {
  id: string
  matterId: string | null
  matterLabel: string | null
  title: string
  kind: string
  dueAt: string
  status: string
  assigneeName: string | null
  overdue: boolean
  createdAt: string
  updatedAt: string
}

// ─── Rótulos pt-BR (Fase 5) ─────────────────────────────────────────────────

export const LEAVE_KIND_LABEL: Record<string, string> = {
  licenca: 'Licença',
  afastamento: 'Afastamento',
  suplencia: 'Suplência',
}

export const COMMITTEE_KIND_LABEL: Record<string, string> = {
  permanente: 'Permanente',
  temporaria: 'Temporária',
  especial: 'Especial',
}

export const COMMITTEE_MEMBER_ROLE_LABEL: Record<string, string> = {
  presidente: 'Presidente',
  vice: 'Vice-Presidente',
  relator: 'Relator',
  titular: 'Titular',
  suplente: 'Suplente',
}

export const COMMITTEE_MEETING_STATUS_LABEL: Record<string, string> = {
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
}

export const PROCEEDING_ACTION_LABEL: Record<string, string> = {
  despacho: 'Despacho',
  parecer: 'Parecer',
  emenda: 'Emenda',
  inclusao_pauta: 'Inclusão em pauta',
  sessao: 'Sessão',
  sanco: 'Sanção',
  veto: 'Veto',
  arquivamento: 'Arquivamento',
  desarquivamento: 'Desarquivamento',
  outro: 'Outro',
}

export const PROTOCOL_KIND_LABEL: Record<string, string> = {
  materia: 'Matéria',
  documento: 'Documento',
  oficio: 'Ofício',
  requerimento: 'Requerimento',
}

export const PROTOCOL_STATUS_LABEL: Record<string, string> = {
  recebido: 'Recebido',
  distribuido: 'Distribuído',
  arquivado: 'Arquivado',
  anulado: 'Anulado',
}

export const TASK_KIND_LABEL: Record<string, string> = {
  prazo: 'Prazo',
  parecer: 'Parecer',
  distribuicao: 'Distribuição',
  outro: 'Outro',
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

export const MATTER_ATTACHMENT_KIND_LABEL: Record<string, string> = {
  texto_integral: 'Texto integral',
  anexo: 'Anexo',
  parecer: 'Parecer',
  emenda: 'Emenda',
  outro: 'Outro',
}

// ─── Fase 6: Portal público, dados abertos, notificações e webhooks ─────────

/** Módulos navegáveis (usado para validar `module` de Notification). */
export const MODULE_IDS = [
  'dashboard',
  'sessions',
  'plenary',
  'display',
  'pwa',
  'parliamentarians',
  'matters',
  'audit',
  'reports',
  'portal',
  'settings',
  'structure',
  'workflow',
  'webhooks',
] as const

export type NotificationKind = 'session' | 'voting' | 'task' | 'webhook' | 'system'

export type NotificationView = {
  id: string
  title: string
  body: string
  kind: NotificationKind
  module: string | null
  targetRole: Role | null
  readAt: string | null
  createdAt: string
}

export type WebhookEndpointView = {
  id: string
  url: string
  events: string[]
  description: string | null
  active: boolean
  secretMasked: string
  deadCount: number
  createdAt: string
  updatedAt: string
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'dead'

export type WebhookDeliveryView = {
  id: string
  endpointId: string
  eventType: string
  status: WebhookDeliveryStatus
  attempts: number
  lastError: string | null
  responseStatus: number | null
  nextAttemptAt: string | null
  createdAt: string
  deliveredAt: string | null
}

/** Eventos aceitos na inscrição de webhooks (allowlist). */
export const WEBHOOK_EVENT_TYPES = [
  'session.state_changed',
  'session.quorum',
  'attendance.changed',
  'agenda.updated',
  'voting.created',
  'voting.state_changed',
  'voting.result',
  'speech.state_changed',
  'matter.proceeding',
  'matter.status_changed',
  // Fases 10–11 — faturamento e publicações/participação
  'billing.invoice_created',
  'billing.invoice_paid',
  'billing.invoice_overdue',
  'publication.published',
  'publication.revoked',
  'hearing.state_changed',
  'test.ping',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

// ─── Portal público: pesquisa e histórico ───────────────────────────────────

export type MatterPublicView = {
  id: string
  type: MatterType
  number: number
  year: number
  ementa: string
  authors: string[]
  status: MatterStatus
  regime: 'ordinario' | 'urgencia'
  createdAt: string
}

export type PublicMatterDetail = {
  matter: MatterPublicView
  proceedings: Array<{ seq: number; action: string; toStatus: string; createdAt: string }>
  lastVoting: {
    id: string
    question: string
    mode: VotingMode
    resultStatus: string
    resultCounts: ResultCounts | null
    closedAt: string | null
    nominalDetail: Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null
  } | null
  versions: Array<{ version: number; authorName: string; createdAt: string }>
}

export type PublicSessionSummary = {
  id: string
  number: number
  year: number
  type: SessionType
  scheduledAt: string
  status: SessionStatus
  agendaPublished: boolean
}

export type PublicSessionDetail = {
  session: PublicSessionSummary
  agenda: Array<Pick<AgendaItemView, 'id' | 'order' | 'section' | 'title' | 'status' | 'resultSummary'>>
  agendaRevision: { number: number; publishedAt: string; justification: string | null; noticeSha256: string | null } | null
  attendance: {
    present: Array<{ name: string; party: string }>
    presentCount: number
    totalMembers: number
  } | null
  votings: Array<{
    id: string
    question: string
    mode: VotingMode
    resultStatus: string | null
    resultCounts: ResultCounts | null
    closedAt: string | null
    nominalDetail: Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null
  }>
  speeches: Array<{ speakerName: string; kind: string; subject: string | null; durationSeconds: number }>
}

export type OpenDataDataset = 'matters' | 'sessions' | 'attendance' | 'votes'

// ─── Fase 6: Minuta de ata ─────────────────────────────────────────────────

export type AtaReportView = {
  session: {
    id: string
    label: string
    type: SessionType
    number: number
    year: number
    scheduledAt: string
    openedAt: string | null
    closedAt: string | null
    presidentName: string | null
    secretaryName: string | null
    location: string
    status: SessionStatus
  }
  opening: string
  attendanceSummary: {
    presentCount: number
    totalMembers: number
    requiredQuorum: number
    present: string[]
    byCategory: Array<{ status: string; names: string[] }>
  }
  expediente: Array<{ order: number; title: string; status: string; resultSummary: string | null }>
  votings: Array<{
    id: string
    question: string
    mode: VotingMode
    rule: VotingRule
    result: string
    counts: ResultCounts | null
    nominal: Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null
  }>
  speeches: Array<{ speakerName: string; kind: string; subject: string | null; durationSeconds: number }>
  closing: string
  verificationCode: string
}

// ─── Rótulos pt-BR (Fase 6) ─────────────────────────────────────────────────

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  session: 'Sessão',
  voting: 'Votação',
  task: 'Tarefa',
  webhook: 'Webhook',
  system: 'Sistema',
}

export const WEBHOOK_EVENT_LABEL: Record<string, string> = {
  'session.state_changed': 'Estado da sessão',
  'session.quorum': 'Quórum',
  'attendance.changed': 'Presença',
  'agenda.updated': 'Pauta',
  'voting.created': 'Votação criada',
  'voting.state_changed': 'Estado da votação',
  'voting.result': 'Resultado de votação',
  'speech.state_changed': 'Discurso',
  'matter.proceeding': 'Tramitação de matéria',
  'matter.status_changed': 'Situação de matéria',
  'test.ping': 'Teste de integração',
}

export const DELIVERY_STATUS_LABEL: Record<WebhookDeliveryStatus, string> = {
  pending: 'Pendente',
  success: 'Entregue',
  failed: 'Falhou',
  dead: 'Morta (dead-letter)',
}

// ─── Fase 7: IA assistiva & App do Parlamentar (PWA) ────────────────────

export type AiArtifactKind = 'ata_draft' | 'ementa' | 'proceedings_summary' | 'transcript' | 'ocr_text'
export type AiArtifactStatus = 'draft' | 'approved' | 'rejected'

export const AI_KIND_LABEL: Record<AiArtifactKind, string> = {
  ata_draft: 'Minuta de ata',
  ementa: 'Ementa sugerida',
  proceedings_summary: 'Resumo de tramitação',
  transcript: 'Transcrição de áudio',
  ocr_text: 'Texto extraído (OCR)',
}

export const AI_STATUS_LABEL: Record<AiArtifactStatus, string> = {
  draft: 'Rascunho',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
}

/** Artefato de IA — sempre rascunho até revisão humana (nunca documento oficial). */
export type AiArtifactView = {
  id: string
  kind: AiArtifactKind
  sessionId: string | null
  matterId: string | null
  model: string
  provider: string
  status: AiArtifactStatus
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  /** Saída do modelo (JSON parseado; estrutura varia por kind). */
  output: Record<string, unknown>
}

/** Saída de POST /ai/ata-draft — minuta de ata em seções numeradas. */
export type AtaDraftOutput = {
  titulo: string
  secoes: Array<{ titulo: string; texto: string }>
  observacao: string
}

/** Saída de POST /ai/ementa — ementa aprimorada + classificação temática. */
export type EmentaSuggestion = {
  ementaSugerida: string
  temas: string[]
  justificativa: string
}

/** Saída de POST /ai/proceedings-summary — resumo executivo da tramitação. */
export type ProceedingsSummary = {
  resumo: string
  proximosPassos: string[]
}

/** Votação ativa vista pelo parlamentar no app (sem detalhe nominal alheio). */
export type MeActiveVoting = {
  id: string
  sessionId: string
  question: string
  mode: VotingMode
  status: VotingStatus
  rule: VotingRule
  hidePartial: boolean
  registeredCount: number
  openedAt: string | null
  closedAt: string | null
  resultStatus: string | null
}

export type MeContextView = {
  parliamentarian: ParliamentarianView
  session: {
    id: string
    label: string
    type: SessionType
    number: number
    year: number
    scheduledAt: string
    status: SessionStatus
    presidentName: string | null
    location: string
    quorum: QuorumInfo
  } | null
  attendance: { status: AttendanceStatus; present: boolean; lastEventAt: string | null } | null
  activeVoting: {
    voting: MeActiveVoting
    /** null quando votação secreta — o próprio valor jamais é ecoado. */
    myVote: { value: VoteValue | null; receivedAt: string | null; changedAt: string | null } | null
    eligible: boolean
  } | null
  speechQueue: {
    mine: { id: string; kind: string; subject: string | null; status: string; plannedSeconds: number } | null
    position: number | null
    total: number
  }
  tenantSettings: TenantSettings
}

export type MeHistoryView = {
  attendance: Array<{
    sessionId: string
    number: number
    year: number
    date: string
    status: AttendanceStatus
  }>
  votes: Array<{
    votingId: string
    sessionId: string
    question: string
    value: VoteValue | null
    closedAt: string | null
  }>
}

// ═══ Fase 8 — Console da Plataforma SaaS & Migração ═════════════════════════

export type PlanLimits = {
  maxParliamentarians: number | null
  maxSessionsPerMonth: number | null
  features: string[]
}

export type PlanView = {
  id: string
  name: string
  priceCents: number
  active: boolean
  limits: PlanLimits
  subscriptions?: number
}

export type SubscriptionView = {
  status: string // trial|active|past_due|canceled
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  plan: { id: string; name: string; priceCents: number; features: string[] }
}

export type TenantConsoleView = {
  id: string
  name: string
  slug: string
  city: string
  uf: string
  active: boolean
  createdAt: string
  subscription: SubscriptionView | null
  usage: { parliamentarians: number; sessions: number; matters: number; votes: number }
  healthScore: number
  healthDetail: { score: number; sessionsLast30d: number; deadWebhooks: number }
}

export type PlatformOverviewView = {
  tenants: { total: number; active: number }
  sessionsThisMonth: number
  votesTotal: number
  outboxPublished: number
  webhooksDead: number
  plans: number
}

export type MigrationIssueView = {
  id: string
  severity: string // info|warn|error
  sourceRef: string | null
  message: string
}

export type MigrationRunView = {
  id: string
  tenantId: string
  stage: string // inspect|validate|plan|dry_run|import|reconcile|report|rollback
  status: string // running|completed|failed
  homologated: boolean
  stats: Record<string, unknown>
  report: Record<string, unknown> | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  issueCounts: { info: number; warn: number; error: number }
  mappingCount: number
  issues?: MigrationIssueView[]
}

export const MIGRATION_STAGES = [
  { id: 'inspect', label: 'Inspecionar', description: 'Identifica a fonte legada, tabelas e contagens.' },
  { id: 'validate', label: 'Validar', description: 'Detecta órfãos, duplicidades e valores inválidos.' },
  { id: 'plan', label: 'Planejar', description: 'Mapeia estruturas e situações do legado para o novo modelo.' },
  { id: 'dry_run', label: 'Simular', description: 'Executa a transformação em memória, sem gravar.' },
  { id: 'import', label: 'Importar', description: 'Grava em lotes transacionais e retomáveis.' },
  { id: 'reconcile', label: 'Reconciliar', description: 'Compara contagens, amostras e checksums.' },
  { id: 'report', label: 'Relatório', description: 'Consolida divergências e assina o resultado.' },
  { id: 'rollback', label: 'Rollback', description: 'Remove exclusivamente os dados desta execução (se não homologada).' },
] as const

export const PLAN_STATUS_LABEL: Record<string, string> = {
  trial: 'Em trial',
  active: 'Ativa',
  past_due: 'Inadimplente',
  canceled: 'Cancelada',
}

export const MIGRATION_SEVERITY_LABEL: Record<string, string> = {
  info: 'Informação',
  warn: 'Aviso',
  error: 'Erro',
}

// ─── Fase 13: Agenda Legislativa & pesquisa unificada ───────────────────────

export type CalendarEventKind = 'session' | 'hearing' | 'committee_meeting' | 'task_deadline'

export const CALENDAR_KIND_LABEL: Record<CalendarEventKind, string> = {
  session: 'Sessão',
  hearing: 'Audiência pública',
  committee_meeting: 'Reunião de comissão',
  task_deadline: 'Prazo',
}

export type CalendarEventView = {
  id: string
  kind: CalendarEventKind
  title: string
  /** ISO 8601 (data/hora do evento) */
  date: string
  status: string
  meta: string | null
  /** Módulo destino ao clicar em "Ir para…" */
  module: string | null
}

export type CalendarResponse = {
  year: number
  month: number // 1–12
  events: CalendarEventView[]
}

export type SearchSectionId = 'matters' | 'sessions' | 'parliamentarians' | 'publications'

export const SEARCH_SECTION_LABEL: Record<SearchSectionId, string> = {
  matters: 'Matérias',
  sessions: 'Sessões',
  parliamentarians: 'Parlamentares',
  publications: 'Publicações',
}

export type SearchItemView = {
  id: string
  title: string
  hint: string | null
  module: string
}

export type SearchResponse = {
  query: string
  sections: Array<{ id: SearchSectionId; items: SearchItemView[] }>
}

// ─── Fase 14: Modelos de documento versionados por tenant ───────────────────

export type TemplateKind = 'ata_sessao' | 'decreto' | 'resolucao' | 'portaria' | 'edital' | 'oficio'

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  ata_sessao: 'Ata de sessão',
  decreto: 'Decreto',
  resolucao: 'Resolução',
  portaria: 'Portaria',
  edital: 'Edital',
  oficio: 'Ofício',
}

export const TEMPLATE_PLACEHOLDERS = [
  { token: '{{camara}}', description: 'Nome da Câmara (tenant)' },
  { token: '{{cidade}}', description: 'Cidade' },
  { token: '{{uf}}', description: 'UF' },
  { token: '{{data}}', description: 'Data de hoje (pt-BR)' },
  { token: '{{hora}}', description: 'Hora atual (pt-BR)' },
  { token: '{{ano}}', description: 'Ano corrente' },
  { token: '{{sessao.numero}}', description: 'Número/tipo da sessão do contexto' },
  { token: '{{sessao.data}}', description: 'Data da sessão do contexto' },
  { token: '{{sessao.tipo}}', description: 'Tipo da sessão do contexto' },
  { token: '{{materia.titulo}}', description: 'Título da matéria do contexto' },
  { token: '{{materia.ementa}}', description: 'Ementa da matéria do contexto' },
  { token: '{{materia.autores}}', description: 'Autores da matéria do contexto' },
] as const

export type TemplateVersionView = {
  id: string
  version: number
  changeNote: string | null
  authorName: string
  createdAt: string
}

export type TemplateView = {
  id: string
  name: string
  kind: TemplateKind
  description: string | null
  active: boolean
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export type TemplateDetail = TemplateView & {
  bodyMd: string
  versions: TemplateVersionView[]
}

export type TemplateRenderResponse = {
  rendered: string
  unresolved: string[]
  templateId: string
  version: number
}

// ─── Fase 15: Central de ajuda e documentação in-app ────────────────────────

export type HelpStep = { title: string; body: string }

export type HelpGuide = {
  role: Role
  title: string
  description: string
  steps: HelpStep[]
  modules: string[]
}

export type GlossaryTerm = { term: string; definition: string }

export type FaqItem = { question: string; answer: string }

export type ShortcutItem = { keys: string; description: string; scope: string }

export type ChangelogEntry = {
  version: string
  date: string
  title: string
  highlights: string[]
}

export type HelpAbout = {
  productName: string
  version: string
  summary: string
  stack: string[]
  documents: Array<{ name: string; path: string; description: string }>
}

export type HelpContent = {
  guides: HelpGuide[]
  glossary: GlossaryTerm[]
  faq: FaqItem[]
  shortcuts: ShortcutItem[]
  changelog: ChangelogEntry[]
  about: HelpAbout
}

// ─── Fase 16: Observabilidade, exportação e encerramento ────────────────────

export type ServiceHealth = {
  id: string
  name: string
  url: string
  ok: boolean
  latencyMs: number | null
  detail: string | null
}

export type SystemStatusView = {
  checkedAt: string
  services: ServiceHealth[]
  database: { fileBytes: number; walBytes: number | null }
  queues: {
    outboxPending: number
    outboxOldestPendingMinutes: number | null
    webhookPending: number
    webhookDead: number
  }
  activity: {
    tenantsActive: number
    tenantsTotal: number
    sessionsToday: number
    lastAuditAt: string | null
  }
  runtime: { uptimeSeconds: number; heapUsedMb: number; heapTotalMb: number }
  alerts: Array<{ id: string; severity: 'info' | 'warn' | 'critical'; title: string; action: string }>
}

// ─── Onda 4 / Fase 17: ciclo de vida da matéria ─────────────────────────────

export type MatterRelatedKind = 'altera' | 'revoga' | 'regula' | 'subsidiaria' | 'emenda' | 'substitutivo'
export type MatterOutcomeKind = 'sancao' | 'veto_total' | 'veto_parcial'

export type MatterRef = {
  id: string
  type: MatterType
  number: number
  year: number
  ementa: string
  status: MatterStatus
}

export type RelatedMatterView = {
  id: string
  kind: MatterRelatedKind
  notes: string | null
  direction: 'from' | 'to' // vinculada POR esta matéria | vinculada A esta matéria
  matter: MatterRef
}

export type MatterOutcomeView = {
  id: string
  kind: MatterOutcomeKind
  actorName: string
  date: string
  notes: string | null
  dueAt: string | null
}

export const MATTER_RELATED_KIND_LABEL: Record<MatterRelatedKind, string> = {
  altera: 'Altera',
  revoga: 'Revoga',
  regula: 'Regulamenta',
  subsidiaria: 'Subsidiária',
  emenda: 'Emenda',
  substitutivo: 'Substitutivo',
}

export const MATTER_OUTCOME_KIND_LABEL: Record<MatterOutcomeKind, string> = {
  sancao: 'Sanção',
  veto_total: 'Veto total',
  veto_parcial: 'Veto parcial',
}

// ─── Onda 4 / Fase 18: votação avançada (opções + recibos) ──────────────────

export type VotingOptionView = { key: string; label: string; order: number }
export type VotingOptionInput = { key: string; label: string }

export type VoteReceiptRow = {
  parliamentarianId: string
  parliamentarianName: string
  receiptCode: string
  issuedAt: string
}

export type ReceiptsVerificationView = {
  ok: boolean
  recomputedCount: number
  mismatchCount: number
  mode: VotingMode
  secret: false // constante documentacional: o segredo jamais sai do servidor
  receipts: VoteReceiptRow[]
}

// ─── Onda 4 / Fase 19: participação e confiança pública ─────────────────────

export type SubscriptionTargetKind = 'matter' | 'session' | 'hearing'

export type CitizenSubscriptionView = {
  id: string
  email: string
  targetKind: SubscriptionTargetKind
  targetId: string
  targetLabel: string | null
  confirmedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export type SubscriptionStats = {
  total: number
  confirmed: number
  pending: number
  byTarget: Array<{ targetKind: SubscriptionTargetKind; targetId: string; targetLabel: string | null; confirmed: number }>
}

export type PublicVerifyResult = {
  found: boolean
  kind: 'publication' | 'ata' | null
  code: string
  title: string | null
  tenantName: string | null
  publishedAt: string | null
  status: 'valida' | 'revogada' | 'nao_encontrada'
}

export const SUBSCRIPTION_TARGET_LABEL: Record<SubscriptionTargetKind, string> = {
  matter: 'Matéria',
  session: 'Sessão',
  hearing: 'Audiência pública',
}

// ─── Onda 4 / Fase 20: operação e suporte da plataforma ─────────────────────

export type SupportImpersonationView = {
  id: string
  supportName: string
  targetName: string
  reason: string
  startedAt: string
  expiresAt: string
  endedAt: string | null
  active: boolean
}

export type ImpersonationBannerView = {
  impersonationId: string
  supportName: string
  targetName: string
  reason: string
  expiresAt: string
}

export type PlatformAlertView = {
  id: string
  kind: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  actionHint: string | null
  createdAt: string
  ackAt: string | null
  ackBy: string | null
}

export type ExportJobStatus = 'pending' | 'running' | 'done' | 'failed'

export type ExportJobView = {
  id: string
  status: ExportJobStatus
  progress: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export const EXPORT_JOB_STATUS_LABEL: Record<ExportJobStatus, string> = {
  pending: 'Na fila',
  running: 'Gerando',
  done: 'Concluído',
  failed: 'Falhou',
}

// ─── v0.12.0: Planejamento e Roadmap (Onda 5 — ROADMAP §12) ─────────────────

export type RoadmapTaskStatus = 'pendente' | 'em_andamento' | 'concluido' | 'bloqueado'

export const ROADMAP_TASK_STATUS_LABEL: Record<RoadmapTaskStatus, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  bloqueado: 'Bloqueado',
}

export type RoadmapTaskView = {
  id: string
  phaseCode: string
  title: string
  detail: string
  status: RoadmapTaskStatus
  order: number
  updatedByName: string | null
  updatedAt: string | null
}

export type RoadmapPhaseView = {
  code: string
  wave: string
  name: string
  period: string
  objective: string
  status: string
  order: number
  tasks: RoadmapTaskView[]
  progress: { done: number; total: number; percent: number }
}

/** Fase/mapa entregue ou planejado — exibido na visão geral do módulo. */
export type RoadmapDeliveredWave = {
  wave: string
  phases: string
  version: string
  summary: string
}

/** Item do mapa-alvo TO-BE v5 (menu/módulo com estado e nota). */
export type RoadmapMenuItem = {
  label: string
  state: 'existente' | 'novo' | 'estendido'
  note?: string
}

export type RoadmapMenuGroup = {
  group: string
  items: RoadmapMenuItem[]
}

/** Documento do pacote documental (entregue ou planejado). */
export type RoadmapDocItem = {
  name: string
  path: string | null
  content: string
  status: 'entregue' | 'planejado'
  phase: string
}

/** Fase da Onda 6 (prévia de longo prazo). */
export type RoadmapPreviewPhase = {
  code: string
  name: string
  summary: string
}

export type RoadmapContent = {
  meta: {
    currentVersion: string
    plannedVersion: string
    module: string
    modules: number
    routeGroups: number
    adrs: number
    miniServices: string[]
    source: string
  }
  delivered: RoadmapDeliveredWave[]
  phases: RoadmapPhaseView[]
  menuV5: RoadmapMenuGroup[]
  docs: RoadmapDocItem[]
  wave6: RoadmapPreviewPhase[]
  execution: { task: string; phase: string; executor: string; status: string }[]
}

// ─── Onda 5 / Fase 21: agendador de tarefas (ROADMAP §12.1) ──────────────────

export type ScheduledJobKind =
  | 'alert.scan'
  | 'export.watchdog'
  | 'health.check'
  | 'tenant.health_snapshot'
  | 'notice.deadline_alerts'

export const SCHEDULED_JOB_KIND_LABEL: Record<ScheduledJobKind, string> = {
  'alert.scan': 'Varredura de alertas',
  'export.watchdog': 'Watchdog de exportações',
  'health.check': 'Health check de serviços',
  'tenant.health_snapshot': 'Snapshot de saúde dos tenants',
  'notice.deadline_alerts': 'Avisos de prazo de convocação',
}

export type ScheduledJobView = {
  id: string
  kind: ScheduledJobKind
  title: string
  everySeconds: number
  lastRunAt: string | null
  nextRunAt: string
  lastStatus: string | null // ok|error|skipped
  lastNote: string | null
  active: boolean
  updatedBy: string | null
  updatedAt: string | null
}

// ─── Onda 5 / Fase 22: MFA, sessões ativas e assinatura eletrônica ──────────

/** Setup TOTP — segredo retornado UMA vez (nunca após habilitado). */
export type MfaSetupView = {
  secret: string
  otpauthUrl: string
}

/** Sessão ativa do próprio usuário (GET /auth/sessions). */
export type AuthSessionView = {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  lastUsedAt: string | null
  current: boolean
}

export type DocumentSignatureView = {
  id: string
  kind: string
  documentId: string
  signatoryParliamentarianId: string
  signatoryName: string
  docHash: string
  prevHash: string | null
  signatureCode: string
  signedAt: string
}

/** Painel de assinaturas da ata (GET /reports/session/:id/ata/signatures). */
export type AtaSignaturesView = {
  sessionId: string
  sessionLabel: string
  published: boolean
  documentId: string | null
  docHash: string | null
  eligible: Array<{
    parliamentarianId: string
    name: string
    signed: boolean
    signedAt: string | null
    signatureCode: string | null
  }>
  signatures: DocumentSignatureView[]
  chainValid: boolean
}

/** Ata pública com assinaturas (GET /public/documents/ata/:sessionId). */
export type PublicAtaView = {
  sessionLabel: string
  publishedAt: string | null
  contentMd: string
  docHash: string
  signatures: Array<{ signatoryName: string; signedAt: string; signatureCode: string }>
  chainValid: boolean
}

/** Verificação pública por código (GET /public/documents/verify-signature?code=). */
export type SignatureVerificationView = {
  valid: boolean
  document: string | null
  signatoryName: string | null
  signedAt: string | null
}

// ─── Onda 5 / Fase 23: chaves de API (ROADMAP §12.3) ─────────────────────────

export type ApiScope = 'matters.read' | 'sessions.read' | 'publications.read' | 'calendar.read'

export const API_SCOPES: ApiScope[] = ['matters.read', 'sessions.read', 'publications.read', 'calendar.read']

export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  'matters.read': 'Matérias (leitura)',
  'sessions.read': 'Sessões e pautas (leitura)',
  'publications.read': 'Publicações (leitura)',
  'calendar.read': 'Calendário legislativo (leitura)',
}

export const API_SCOPE_ENDPOINT: Record<ApiScope, string> = {
  'matters.read': '/api/v1/external/matters',
  'sessions.read': '/api/v1/external/sessions',
  'publications.read': '/api/v1/external/publications',
  'calendar.read': '/api/v1/external/calendar',
}

export type ApiKeyView = {
  id: string
  name: string
  prefix: string
  scopes: ApiScope[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** POST /api-keys — a chave completa é exibida UMA única vez. */
export type ApiKeyCreatedView = {
  key: ApiKeyView
  secret: string
}

/** Resultado do playground (fetch server-side — a chave nunca vai ao browser). */
export type PlaygroundResultView = {
  status: number
  latencyMs: number
  body: unknown
}

// ─── Onda 5 / Fase 24: crescimento do SaaS (ROADMAP §12.4) ───────────────────

export type OnboardingStatus = 'pendente' | 'ativada' | 'rejeitada'

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  pendente: 'Pendente',
  ativada: 'Ativada',
  rejeitada: 'Rejeitada',
}

export type OnboardingRequestView = {
  id: string
  chamberName: string
  city: string
  uf: string
  email: string
  slug: string
  status: OnboardingStatus
  note: string | null
  createdAt: string
}

/** Ativação de trial — senha temporária do owner exibida UMA vez (sem SMTP). */
export type OnboardingActivationView = {
  request: OnboardingRequestView
  tenantName: string
  temporaryPassword: string
}

export type TenantHealthMetrics = {
  sessions30d: number
  matters30d: number
  logins30d: number
  activeWebhooks: number
}

export type TenantHealthView = {
  tenantId: string
  tenantName: string
  slug: string
  score: number // 0–100
  bucket: 'saudavel' | 'atencao' | 'risco'
  metrics: TenantHealthMetrics
  trend: number | null // variação vs. snapshot anterior
  capturedAt: string
}

export const HEALTH_BUCKET_LABEL: Record<TenantHealthView['bucket'], string> = {
  saudavel: 'Saudável',
  atencao: 'Atenção',
  risco: 'Risco',
}

export type PlatformMetricsView = {
  activeTenants: number
  mrrCents: number
  churn90d: number
  trials: number
  npsAverage: number | null
  npsResponses: number
}

/** Resposta NPS do próprio usuário (widget da Central de Ajuda). */
export type MyNpsView = {
  score: number | null
  comment: string | null
  version: string
}
