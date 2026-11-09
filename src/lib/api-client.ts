/**
 * Cliente tipado da API Legis SaaS (/api/v1).
 * Injeta x-actor-id (ator demo) em todas as chamadas.
 */
import type {
  AgendaItemView,
  ApiError,
  AuditView,
  BootstrapView,
  MatterView,
  ParliamentarianView,
  PublicLiveView,
  QuorumInfo,
  ReportView,
  SessionDetail,
  SessionSummary,
  SpeechView,
  TenantView,
  TenantContact,
  AttendanceRow,
  VotingView,
  VoteRow,
  DisplayCommandPayload,
  DisplayStateView,
  SessionType,
  VotingMode,
  VotingRule,
  MatterType,
  MatterStatus,
  LegislatureView,
  PartyView,
  BlocView,
  BoardPositionView,
  CommitteeView,
  CommitteeMemberView,
  CommitteeMeetingView,
  LeaveView,
  MandateView,
  MatterTypeConfigView,
  ProceedingView,
  MatterVersionView,
  MatterAttachmentView,
  ProtocolEntryView,
  LegislativeTaskView,
  NotificationView,
  WebhookEndpointView,
  WebhookDeliveryView,
  MatterPublicView,
  PublicMatterDetail,
  PublicSessionSummary,
  PublicSessionDetail,
  AtaReportView,
  AiArtifactKind,
  AiArtifactView,
  AtaDraftOutput,
  EmentaSuggestion,
  ProceedingsSummary,
  MeContextView,
  MeHistoryView,
  VoteValue,
  VotingOptionInput,
  VotingOptionView,
  ReceiptsVerificationView,
  RoadmapContent,
  RoadmapTaskStatus,
  RoadmapTaskView,
  ScheduledJobView,
  MfaSetupView,
  AuthSessionView,
  DocumentSignatureView,
  AtaSignaturesView,
  PublicAtaView,
  SignatureVerificationView,
  ApiScope,
  ApiKeyView,
  ApiKeyCreatedView,
  PlaygroundResultView,
  OnboardingRequestView,
  OnboardingActivationView,
  TenantHealthView,
  PlatformMetricsView,
  MyNpsView,
  TransmissionView,
  MediaDestinationsView,
  MediaPublicObservationsView,
  MediaPublicObservationView,
  MediaRecordingView,
  SessionReadinessView,
  RecordingArchiveView,
  PlatformOverviewView,
  TenantConsoleView,
  PlanView,
  MigrationRunView,
  OfficialConfigurationView,
  SessionDocumentView,
  NoticeDeliveryView,
} from './contracts'

/** Fase 18 — recibo verificável do próprio parlamentar (GET /me/receipts). */
export type MyVoteReceiptRow = {
  id: string
  votingId: string
  question: string
  mode: VotingMode
  closedAt: string
  receiptCode: string
  issuedAt: string
}

/** Fase 18 — contexto /me com as opções customizadas da votação ativa (aditivo). */
export type MeContextViewExt = Omit<MeContextView, 'activeVoting'> & {
  activeVoting: (NonNullable<MeContextView['activeVoting']> & {
    voting: NonNullable<MeContextView['activeVoting']>['voting'] & { options?: VotingOptionView[] }
  }) | null
}

/** Fase 18 — votação do telão com os rótulos das opções customizadas (aditivo). */
export type PublicLiveOptionExt = { options?: VotingOptionView[] }

/** Fase 18 — public/live com opções customizadas em currentVoting/lastResults. */
export type PublicLiveViewExt = Omit<PublicLiveView, 'currentVoting' | 'lastResults'> & {
  currentVoting: (NonNullable<PublicLiveView['currentVoting']> & PublicLiveOptionExt) | null
  lastResults: Array<PublicLiveView['lastResults'][number] & PublicLiveOptionExt>
}

const BASE = '/api/v1'

export class ApiRequestError extends Error {
  constructor(public readonly problem: ApiError) {
    super(problem.detail || problem.title)
  }
}

async function request<T>(path: string, init?: RequestInit & { actorId?: string; silent?: boolean }): Promise<T> {
  const { actorId: requestedActorId, silent, ...fetchInit } = init ?? {}
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  const actorId = requestedActorId ?? (typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null)
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(`${BASE}${path}`, { ...fetchInit, headers })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const problem: ApiError = (body ?? {
      type: 'about:blank',
      title: 'Erro de rede',
      status: res.status,
      detail: `Falha na requisição (${res.status})`,
      code: 'NETWORK_ERROR',
      correlationId: '—',
    }) as ApiError
    const err = new ApiRequestError(problem)
    // 401 sem ator selecionado (gate de entrada aberto) é ruído esperado:
    // consultas de fundo ainda não têm credencial — não dispara toast.
    const gateMode = problem.status === 401 && !actorId
    if (typeof window !== 'undefined' && problem.status >= 400 && !gateMode && !silent) {
      window.dispatchEvent(new CustomEvent('legis:api-error', { detail: err }))
    }
    throw err
  }
  return body as T
}

export const api = {
  // Bootstrap
  bootstrap: () => request<BootstrapView>('/bootstrap'),
  officialConfiguration: () => request<OfficialConfigurationView>('/official-configuration'),
  approveOfficialConfiguration: (data: { expectedSha256: string; approvalReference: string; acknowledged: true }) =>
    request<{ revision: { id: string; version: number } }>('/official-configuration', { method: 'POST', body: JSON.stringify(data) }),

  // Sessões
  listSessions: () => request<{ sessions: SessionSummary[] }>('/sessions'),
  createSession: (data: {
    type: SessionType
    scheduledAt: string
    presidentId: string
    secretaryName?: string
    location?: string
    notes?: string
    matterIds?: string[]
    official?: boolean
  }) =>
    request<{ session: SessionSummary }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getSession: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  updateSession: (id: string, data: {
    version: number
    type?: SessionType
    scheduledAt?: string
    presidentId?: string
    secretaryName?: string | null
    location?: string
    notes?: string | null
  }) => request<{ session: SessionSummary }>(`/sessions/${id}`, {
    method: 'PATCH', body: JSON.stringify(data),
  }),
  getTransmission: (id: string) => request<TransmissionView>(`/sessions/${id}/transmission`, { silent: true }),
  getMediaDestinations: (id: string) => request<MediaDestinationsView>(`/sessions/${id}/transmission/destinations`, { silent: true }),
  getMediaPublicObservations: (id: string) => request<MediaPublicObservationsView>(`/sessions/${id}/transmission/observations`, { silent: true }),
  recordMediaPublicObservation: (id: string, data: { destinationId: string; videoOk: true; audioOk: true; evidenceNote: string }) =>
    request<{ observation: MediaPublicObservationView }>(`/sessions/${id}/transmission/observations`, { method: 'POST', body: JSON.stringify(data) }),
  getMediaRecording: (id: string) => request<MediaRecordingView>(`/sessions/${id}/transmission/recording`, { silent: true }),
  getSessionReadiness: (id: string) => request<SessionReadinessView>(`/sessions/${id}/readiness`, { silent: true }),
  getRecordingArchive: (id: string, verify = false) => request<RecordingArchiveView>(`/sessions/${id}/transmission/archive${verify ? '?verify=1' : ''}`, { silent: !verify }),
  commandRecordingArchive: (id: string, data: { action: 'build' | 'publish' | 'withdraw'; version: number; idempotencyKey: string; gapJustification?: string }) =>
    request<RecordingArchiveView>(`/sessions/${id}/transmission/archive`, { method: 'POST', body: JSON.stringify(data) }),
  setTransmissionPublicLink: (id: string, data: { action: 'publish' | 'withdraw'; version: number; idempotencyKey: string; destinationId?: string; platformConfirmed?: boolean; observationId?: string }) =>
    request<TransmissionView>(`/sessions/${id}/transmission/public-link`, { method: 'POST', body: JSON.stringify(data) }),
  setMediaDestination: (id: string, destinationId: string, enabled: boolean) =>
    request<MediaDestinationsView>(`/sessions/${id}/transmission/destinations`, {
      method: 'POST',
      body: JSON.stringify({ destinationId, enabled }),
    }),
  commandTransmission: (id: string, data: {
    action: 'prepare' | 'start_monitoring' | 'stop_monitoring'
    version: number
    idempotencyKey: string
  }) => request<TransmissionView>(`/sessions/${id}/transmission`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  transitionSession: (
    id: string,
    action: string,
    version: number,
    justification?: string,
    noticeExceptionReason?: string
  ) =>
    request<{ session: SessionSummary; quorum: QuorumInfo }>(`/sessions/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ action, version, justification, noticeExceptionReason }),
    }),
  noticeCalendar: () => request<{ timezone: string; generatedAt: string; rows: Array<{
    sessionId: string; number: number; year: number; type: SessionType; phase: 'initial' | 'amendment';
    scheduledAt: string; deadlineAt: string; minimumHours: number;
    state: 'passed' | 'due_soon' | 'on_time'; exceptionAllowed: boolean
  }> }>('/sessions/notice-calendar'),
  attendance: (sessionId: string, parliamentarianId: string, action: string, note?: string, commandId = crypto.randomUUID()) =>
    request<{ attendance: AttendanceRow; quorum: QuorumInfo }>(`/sessions/${sessionId}/attendance`, {
      method: 'POST',
      body: JSON.stringify({ parliamentarianId, action, note, commandId }),
    }),
  addAgenda: (sessionId: string, matterIds: string[]) =>
    request<{ agenda: AgendaItemView[] }>(`/sessions/${sessionId}/agenda`, {
      method: 'POST',
      body: JSON.stringify({ matterIds }),
    }),
  amendAgenda: (sessionId: string, data: {
    action: 'add' | 'move' | 'retire'
    mode: 'preview' | 'apply'
    version: number
    justification: string
    matterId?: string
    itemId?: string
    position?: number
    exceptionReason?: string
  }) => request<{ preview?: { before: Array<{ id: string; title: string; status: string }>; after: Array<{ id: string; title: string; status: string }>; revision: number; summary: string }; amendment?: { revision: number } }>(`/sessions/${sessionId}/agenda-amendments`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  patchAgendaItem: (
    itemId: string,
    data: { action: string; order?: number; status?: string; justification?: string }
  ) =>
    request<{ agenda: AgendaItemView[] }>(`/agenda-items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Votações
  createVoting: (
    sessionId: string,
    data: {
      agendaItemId?: string
      question?: string
      mode: VotingMode
      rule?: VotingRule
      hidePartial?: boolean
      /** Fase 18: opções customizadas (1–5) — substituem sim/nao/abstencao. */
      options?: VotingOptionInput[]
    }
  ) =>
    request<{ voting: VotingView }>(`/sessions/${sessionId}/votings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  transitionVoting: (
    id: string,
    action: string,
    version: number,
    extra?: {
      justification?: string
      sim?: number
      nao?: number
      abstencoes?: number
      /** Fase 18: contagem por chave no encerramento simbólico com opções customizadas. */
      customCounts?: Record<string, number>
    }
  ) =>
    request<{ voting: VotingView }>(`/votings/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ action, version, ...extra }),
    }),
  symbolicTallies: (id: string) => request<{ revisions: Array<{ id: string; revision: number; counts: Record<string, number>;
    proposedByName: string; confirmedByName: string | null; confirmedAt: string | null }> }>(`/votings/${id}/symbolic-tally`),
  changeSymbolicTally: (id: string, data: { action: 'propose' | 'confirm'; version: number; revisionId?: string;
    sim?: number; nao?: number; abstencoes?: number; customCounts?: Record<string, number> }) =>
    request<{ version: number }>(`/votings/${id}/symbolic-tally`, { method: 'POST', body: JSON.stringify(data) }),
  votingImpediments: (id: string) => request<{ policy: 'disabled' | 'retain_base' | 'reduce_base'; policyAtOpen: string | null;
    impediments: Array<{ id: string; parliamentarianId: string; parliamentarianName: string; reason: string }> }>(`/votings/${id}/impediments`),
  changeVotingImpediment: (id: string, data: { action: 'register' | 'revoke'; parliamentarianId: string; version: number; reason: string }) =>
    request<{ version: number }>(`/votings/${id}/impediments`, { method: 'POST', body: JSON.stringify(data) }),
  castVote: (votingId: string, parliamentarianId: string, value: string, commandId: string) =>
    request<{ vote: VoteRow; registeredCount: number }>(`/votings/${votingId}/votes`, {
      method: 'POST',
      body: JSON.stringify({ parliamentarianId, value, commandId }),
    }),
  /** Fase 18 — verificação determinística dos recibos de uma votação encerrada. */
  votingReceipts: (votingId: string) =>
    request<ReceiptsVerificationView>(`/votings/${votingId}/receipts`),

  // Discursos
  listSpeeches: (sessionId: string) => request<{ speeches: SpeechView[] }>(`/sessions/${sessionId}/speeches`),
  enqueueSpeech: (sessionId: string, data: { parliamentarianId?: string; externalSpeaker?: string; kind: string; subject?: string; side?: string; plannedSeconds?: number }) =>
    request<{ speech: SpeechView }>(`/sessions/${sessionId}/speeches`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  transitionSpeech: (id: string, action: string, seconds?: number) =>
    request<{ speech: SpeechView }>(`/speeches/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ action, seconds }),
    }),

  // Cadastros
  listParliamentarians: () => request<{ parliamentarians: ParliamentarianView[] }>('/parliamentarians'),
  uploadParliamentarianImage: async (kind: 'photo' | 'partyEmblem', file: File) => {
    const form = new FormData()
    form.set('kind', kind)
    form.set('file', file)
    const headers = new Headers()
    const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
    if (actorId) headers.set('x-actor-id', actorId)
    const response = await fetch(`${BASE}/parliamentarians/images`, { method: 'POST', headers, body: form })
    const result = await response.json()
    if (!response.ok) throw new ApiRequestError(result as ApiError)
    return result as { url: string }
  },
  createParliamentarian: (data: Partial<ParliamentarianView>) =>
    request<{ parliamentarian: ParliamentarianView }>('/parliamentarians', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateParliamentarian: (id: string, data: Partial<ParliamentarianView>) =>
    request<{ parliamentarian: ParliamentarianView }>(`/parliamentarians/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteParliamentarian: (id: string) =>
    request<{ parliamentarian: ParliamentarianView }>(`/parliamentarians/${id}`, { method: 'DELETE' }),

  listMatters: (filters?: { search?: string; type?: string; year?: string; status?: string }) => {
    const params = new URLSearchParams()
    if (filters?.search) params.set('search', filters.search)
    if (filters?.type) params.set('type', filters.type)
    if (filters?.year) params.set('year', filters.year)
    if (filters?.status) params.set('status', filters.status)
    const qs = params.toString()
    return request<{ matters: MatterView[] }>(`/matters${qs ? `?${qs}` : ''}`)
  },
  createMatter: (data: { type: MatterType; ementa: string; authors: string[]; regime?: string; number?: number }) =>
    request<{ matter: MatterView }>('/matters', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Auditoria
  listAudit: (filters?: { action?: string; aggregateType?: string; aggregateId?: string; limit?: number; verify?: boolean }) => {
    const params = new URLSearchParams()
    if (filters?.action) params.set('action', filters.action)
    if (filters?.aggregateType) params.set('aggregateType', filters.aggregateType)
    if (filters?.aggregateId) params.set('aggregateId', filters.aggregateId)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.verify) params.set('verify', 'true')
    const qs = params.toString()
    return request<{ events: AuditView[]; chain?: { valid: boolean; head: string | null } }>(`/audit${qs ? `?${qs}` : ''}`)
  },

  // Relatórios / portal / tenant
  sessionReport: (sessionId: string) => request<ReportView>(`/reports/session/${sessionId}`),
  publicLive: (tenantSlug: string) => request<PublicLiveViewExt>(`/public/live?tenant=${encodeURIComponent(tenantSlug)}`),
  publicDisplayFrame: (tenantSlug: string, sessionId: string, version: number) =>
    request<{ sessionId: string; version: number; sha256: string; frame: PublicLiveViewExt }>(`/public/display-frame?tenant=${encodeURIComponent(tenantSlug)}&sessionId=${encodeURIComponent(sessionId)}&version=${version}`),
  updateTenant: (id: string, data: { name?: string; city?: string; uf?: string; primaryColor?: string; accentColor?: string; contact?: Partial<TenantContact>; settings?: Record<string, unknown> }) =>
    request<{ tenant: TenantView }>(`/tenants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Telão
  displayCommand: (sessionId: string, payload: DisplayCommandPayload) =>
    request<{ ok: boolean; displayVersion: number }>('/display/command', {
      method: 'POST',
      body: JSON.stringify({ sessionId, ...payload }),
    }),
  displayState: (sessionId: string) => request<{ state: DisplayStateView | null }>(`/display/command?sessionId=${encodeURIComponent(sessionId)}`),

  // ─── Fase 5: Estrutura institucional ──────────────────────────────────────
  listLegislatures: () => request<{ legislatures: LegislatureView[] }>('/legislatures'),
  createLegislature: (data: { number: number | null; startYear: number; endYear: number; current?: boolean }) =>
    request<{ legislature: LegislatureView }>('/legislatures', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLegislature: (id: string, data: { number?: number | null; startYear?: number; endYear?: number; current?: boolean }) =>
    request<{ legislature: LegislatureView }>(`/legislatures/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listParties: () => request<{ parties: PartyView[] }>('/parties'),
  createParty: (data: { acronym: string; name: string; number?: number | null; active?: boolean }) =>
    request<{ party: PartyView }>('/parties', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateParty: (id: string, data: { name?: string; number?: number | null; active?: boolean; emblemUrl?: string | null }) =>
    request<{ party: PartyView }>(`/parties/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listBlocs: () => request<{ blocs: BlocView[] }>('/blocs'),
  createBloc: (data: { name: string; partyAcronyms?: string[]; active?: boolean }) =>
    request<{ bloc: BlocView }>('/blocs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateBloc: (id: string, data: { name?: string; partyAcronyms?: string[]; active?: boolean }) =>
    request<{ bloc: BlocView }>(`/blocs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listBoard: (legislatureId?: string) => {
    const qs = legislatureId ? `?legislatureId=${encodeURIComponent(legislatureId)}` : ''
    return request<{ board: BoardPositionView[] }>(`/board${qs}`)
  },
  createBoardPosition: (data: {
    legislatureId: string
    role: string
    parliamentarianId: string
    startDate?: string
    endDate?: string | null
    status?: 'confirmed' | 'elected'
    electionReference?: string
  }) =>
    request<{ position: BoardPositionView }>('/board', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchBoardPosition: (
    id: string,
    data: { action: 'encerrar' | 'transferir' | 'confirmar_posse' | 'cancelar_eleicao'; parliamentarianId?: string; startDate?: string; confirmationReference?: string }
  ) =>
    request<{ position: BoardPositionView; successor: BoardPositionView | null }>(`/board/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listCommittees: () => request<{ committees: CommitteeView[] }>('/committees'),
  createCommittee: (data: {
    name: string
    acronym: string
    kind?: string
    description?: string | null
    active?: boolean
  }) =>
    request<{ committee: CommitteeView }>('/committees', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCommittee: (
    id: string,
    data: { name?: string; description?: string | null; kind?: string; active?: boolean }
  ) =>
    request<{ committee: CommitteeView }>(`/committees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  listCommitteeMembers: (committeeId: string) =>
    request<{ members: CommitteeMemberView[] }>(`/committees/${committeeId}/members`),
  addCommitteeMember: (
    committeeId: string,
    data: { parliamentarianId: string; role?: string; startDate?: string }
  ) =>
    request<{ member: CommitteeMemberView }>(`/committees/${committeeId}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  endCommitteeMembership: (memberId: string, endDate?: string) =>
    request<{ member: CommitteeMemberView }>(`/committee-members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ endDate }),
    }),
  listCommitteeMeetings: (committeeId: string) =>
    request<{ meetings: CommitteeMeetingView[] }>(`/committees/${committeeId}/meetings`),
  scheduleCommitteeMeeting: (
    committeeId: string,
    data: { scheduledAt: string; subject: string; notes?: string }
  ) =>
    request<{ meeting: CommitteeMeetingView }>(`/committees/${committeeId}/meetings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchCommitteeMeeting: (
    meetingId: string,
    data: { status: 'realizada' | 'cancelada'; notes?: string; justification?: string }
  ) =>
    request<{ meeting: CommitteeMeetingView }>(`/committee-meetings/${meetingId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listLeaves: (parliamentarianId?: string) => {
    const qs = parliamentarianId ? `?parliamentarianId=${encodeURIComponent(parliamentarianId)}` : ''
    return request<{ leaves: LeaveView[] }>(`/leaves${qs}`)
  },
  createLeave: (data: {
    parliamentarianId: string
    kind: string
    startDate: string
    endDate?: string | null
    reason: string
    substituteId?: string | null
  }) =>
    request<{ leave: LeaveView }>('/leaves', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchLeave: (id: string, data: { action: 'encerrar' | 'estender'; endDate?: string }) =>
    request<{ leave: LeaveView }>(`/leaves/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listMandates: (filters?: { legislatureId?: string; parliamentarianId?: string }) => {
    const params = new URLSearchParams()
    if (filters?.legislatureId) params.set('legislatureId', filters.legislatureId)
    if (filters?.parliamentarianId) params.set('parliamentarianId', filters.parliamentarianId)
    const qs = params.toString()
    return request<{ mandates: MandateView[] }>(`/mandates${qs ? `?${qs}` : ''}`)
  },
  createMandate: (data: {
    parliamentarianId: string
    legislatureId: string
    startDate: string
    endDate?: string | null
    votes?: number | null
  }) =>
    request<{ mandate: MandateView }>('/mandates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listMatterTypes: () => request<{ matterTypes: MatterTypeConfigView[] }>('/matter-types'),
  createMatterType: (data: { code: string; name: string; defaultRegime?: string; active?: boolean }) =>
    request<{ matterType: MatterTypeConfigView }>('/matter-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ─── Fase 5: Protocolo e tramitação ───────────────────────────────────────
  listProtocols: (filters?: { year?: string; status?: string; kind?: string }) => {
    const params = new URLSearchParams()
    if (filters?.year) params.set('year', filters.year)
    if (filters?.status) params.set('status', filters.status)
    if (filters?.kind) params.set('kind', filters.kind)
    const qs = params.toString()
    return request<{
      protocols: ProtocolEntryView[]
      counts: Record<string, number>
    }>(`/protocols${qs ? `?${qs}` : ''}`)
  },
  createProtocol: (data: {
    kind: string
    senderName: string
    subject: string
    matterId?: string | null
    notes?: string
  }) =>
    request<{ protocol: ProtocolEntryView }>('/protocols', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchProtocol: (
    id: string,
    data: { action: 'distribuir' | 'arquivar' | 'anular'; matterId?: string; justification?: string; notes?: string }
  ) =>
    request<{ protocol: ProtocolEntryView }>(`/protocols/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listProceedings: (matterId: string) =>
    request<{ proceedings: ProceedingView[] }>(`/matters/${matterId}/proceedings`),
  createProceeding: (
    matterId: string,
    data: {
      action: string
      toStatus: string
      notes?: string
      documentRef?: string
      dueAt?: string
      seq?: number
    }
  ) =>
    request<{ proceeding: ProceedingView; matter: MatterView }>(`/matters/${matterId}/proceedings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listMatterVersions: (matterId: string) =>
    request<{ versions: MatterVersionView[] }>(`/matters/${matterId}/versions`),
  createMatterVersion: (matterId: string, data: { text: string; authorName?: string }) =>
    request<{ version: MatterVersionView }>(`/matters/${matterId}/versions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listMatterAttachments: (matterId: string) =>
    request<{ attachments: MatterAttachmentView[] }>(`/matters/${matterId}/attachments`),
  createMatterAttachment: (
    matterId: string,
    data: { name: string; kind?: string; url?: string; sizeBytes?: number }
  ) =>
    request<{ attachment: MatterAttachmentView }>(`/matters/${matterId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  uploadMatterAttachment: async (matterId: string, data: { name: string; kind: string; file: File }) => {
    const form = new FormData()
    form.set('name', data.name)
    form.set('kind', data.kind)
    form.set('file', data.file)
    const headers = new Headers()
    const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
    if (actorId) headers.set('x-actor-id', actorId)
    const response = await fetch(`${BASE}/matters/${encodeURIComponent(matterId)}/attachments`,
      { method: 'POST', headers, body: form })
    const result = await response.json()
    if (!response.ok) throw new ApiRequestError(result as ApiError)
    return result as { attachment: MatterAttachmentView }
  },
  downloadMatterAttachment: async (matterId: string, attachmentId: string) => {
    const headers = new Headers()
    const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
    if (actorId) headers.set('x-actor-id', actorId)
    const response = await fetch(`${BASE}/matters/${encodeURIComponent(matterId)}/attachments/${encodeURIComponent(attachmentId)}/file`, { headers })
    if (!response.ok) throw new ApiRequestError(await response.json() as ApiError)
    return response.blob()
  },

  listTasks: (filters?: { status?: string; overdue?: boolean }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.overdue) params.set('overdue', 'true')
    const qs = params.toString()
    return request<{ tasks: LegislativeTaskView[]; counts: Record<string, number> }>(`/tasks${qs ? `?${qs}` : ''}`)
  },
  createTask: (data: {
    title: string
    kind?: string
    dueAt: string
    matterId?: string | null
    assigneeName?: string
  }) =>
    request<{ task: LegislativeTaskView }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchTask: (id: string, data: { status: 'concluida' | 'cancelada'; justification?: string }) =>
    request<{ task: LegislativeTaskView }>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // ─── Fase 6: Notificações ─────────────────────────────────────────────────
  listNotifications: (filters?: { unread?: boolean; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters?.unread) params.set('unread', 'true')
    if (filters?.limit) params.set('limit', String(filters.limit))
    const qs = params.toString()
    return request<{ notifications: NotificationView[]; unreadCount: number }>(
      `/notifications${qs ? `?${qs}` : ''}`
    )
  },
  markNotificationRead: (id: string) =>
    request<{ notification: NotificationView }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
  broadcastNotification: (data: {
    title: string
    body: string
    kind?: 'session' | 'voting' | 'task' | 'webhook' | 'system'
    module?: string | null
    targetRole?: string | null
  }) =>
    request<{ notification: NotificationView }>('/notifications', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ─── Fase 6: Webhooks ─────────────────────────────────────────────────────
  listWebhooks: () =>
    request<{ webhooks: WebhookEndpointView[]; allowedEvents: string[] }>('/webhooks'),
  createWebhook: (data: { url: string; events: string[]; description?: string | null }) =>
    request<{ webhook: WebhookEndpointView }>('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateWebhook: (
    id: string,
    data: { active?: boolean; events?: string[]; url?: string; description?: string | null }
  ) =>
    request<{ webhook: WebhookEndpointView }>(`/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteWebhook: (id: string) => request<{ ok: boolean }>(`/webhooks/${id}`, { method: 'DELETE' }),
  listWebhookDeliveries: (endpointId: string, filters?: { status?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.limit) params.set('limit', String(filters.limit))
    const qs = params.toString()
    return request<{
      deliveries: WebhookDeliveryView[]
      counts: Record<string, number>
    }>(`/webhooks/${endpointId}/deliveries${qs ? `?${qs}` : ''}`)
  },
  testWebhook: (id: string) =>
    request<{ delivery: { id: string; eventType: string; status: string } }>(`/webhooks/${id}/test`, {
      method: 'POST',
    }),
  replayWebhookDelivery: (deliveryId: string) =>
    request<{ delivery: { id: string; eventType: string; status: string } }>(
      `/webhooks/deliveries/${deliveryId}/replay`,
      { method: 'POST' }
    ),

  // ─── Fase 6: Portal público (pesquisa, sessões, dados abertos) ────────────
  publicMatters: (
    filters?: {
      tenant?: string
      type?: string
      year?: string
      status?: string
      author?: string
      q?: string
      limit?: number
      cursor?: string | null
    }
  ) => {
    const params = new URLSearchParams()
    if (filters?.tenant) params.set('tenant', filters.tenant)
    if (filters?.type) params.set('type', filters.type)
    if (filters?.year) params.set('year', filters.year)
    if (filters?.status) params.set('status', filters.status)
    if (filters?.author) params.set('author', filters.author)
    if (filters?.q) params.set('q', filters.q)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.cursor) params.set('cursor', filters.cursor)
    return request<{ matters: MatterPublicView[]; nextCursor: string | null }>(
      `/public/matters${params.toString() ? `?${params.toString()}` : ''}`
    )
  },
  publicMatterDetail: (id: string, tenant?: string) => {
    const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''
    return request<PublicMatterDetail>(`/public/matters/${id}${qs}`)
  },
  publicSessions: (filters?: { tenant?: string; year?: string; status?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters?.tenant) params.set('tenant', filters.tenant)
    if (filters?.year) params.set('year', filters.year)
    if (filters?.status) params.set('status', filters.status)
    if (filters?.limit) params.set('limit', String(filters.limit))
    return request<{ sessions: PublicSessionSummary[] }>(
      `/public/sessions${params.toString() ? `?${params.toString()}` : ''}`
    )
  },
  publicSessionDetail: (id: string, tenant?: string) => {
    const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''
    return request<PublicSessionDetail>(`/public/sessions/${id}${qs}`)
  },
  /** URL absoluta do dataset de dados abertos (JSON/CSV). */
  openDataUrl: (dataset: 'matters' | 'sessions' | 'attendance' | 'votes', format: 'json' | 'csv', tenant: string) =>
    `${BASE}/public/open-data?dataset=${dataset}&format=${format}&tenant=${encodeURIComponent(tenant)}`,
  /** Baixa o CSV de dados abertos (texto bruto; a API devolve attachment). */
  fetchOpenDataCsv: async (dataset: 'matters' | 'sessions' | 'attendance' | 'votes', tenant: string) => {
    const res = await fetch(api.openDataUrl(dataset, 'csv', tenant))
    if (!res.ok) throw new ApiRequestError({
      type: 'about:blank',
      title: 'Falha no download',
      status: res.status,
      detail: `Não foi possível baixar o dataset "${dataset}" (${res.status}).`,
      code: 'DOWNLOAD_ERROR',
      correlationId: '—',
    })
    return res.text()
  },

  // ─── Fase 6: Minuta de ata ────────────────────────────────────────────────
  sessionAta: (sessionId: string) => request<{ ata: AtaReportView }>(`/reports/session/${sessionId}/ata`),

  // ─── Fase 7: IA assistiva (rascunho com revisão humana obrigatória) ──────
  aiAtaDraft: (sessionId: string) =>
    request<{ artifact: AiArtifactView; output: AtaDraftOutput }>('/ai/ata-draft', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  aiEmenta: (data: { matterId?: string; text?: string }) =>
    request<{ artifact: AiArtifactView; output: EmentaSuggestion }>('/ai/ementa', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  aiProceedingsSummary: (matterId: string) =>
    request<{ artifact: AiArtifactView; output: ProceedingsSummary }>('/ai/proceedings-summary', {
      method: 'POST',
      body: JSON.stringify({ matterId }),
    }),
  aiTranscribe: (audioBase64: string, meta?: { sessionId?: string; note?: string }) =>
    request<{ artifact: AiArtifactView; text: string }>('/ai/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, ...meta }),
    }),
  aiOcr: (imageBase64: string, mimeType: string) =>
    request<{ artifact: AiArtifactView; text: string }>('/ai/ocr', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    }),
  listAiArtifacts: (filters?: {
    kind?: AiArtifactKind
    sessionId?: string
    matterId?: string
    limit?: number
  }) => {
    const params = new URLSearchParams()
    if (filters?.kind) params.set('kind', filters.kind)
    if (filters?.sessionId) params.set('sessionId', filters.sessionId)
    if (filters?.matterId) params.set('matterId', filters.matterId)
    if (filters?.limit) params.set('limit', String(filters.limit))
    const qs = params.toString()
    return request<{ artifacts: AiArtifactView[] }>(`/ai/artifacts${qs ? `?${qs}` : ''}`)
  },
  reviewAiArtifact: (
    id: string,
    data: { decision: 'approve' | 'reject'; justification?: string }
  ) =>
    request<{ artifact: AiArtifactView }>(`/ai/artifacts/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ─── Fase 7: App do Parlamentar (/me) ────────────────────────────────────
  meContext: () => request<MeContextViewExt>('/me/context'),
  meNotice: (sessionId: string) => request<{ notice: { sessionId: string; revision: number; noticeSha256: string; issuedAt: string; acknowledgedAt: string | null; publicUrl: string | null } | null }>(`/me/notices?sessionId=${encodeURIComponent(sessionId)}`),
  acknowledgeNotice: (notice: { sessionId: string; revision: number; noticeSha256: string }) =>
    request<{ notice: { acknowledgedAt: string } }>('/me/notices', { method: 'POST', body: JSON.stringify(notice) }),
  noticeRecipients: (sessionId: string) => request<{ revision: number | null; noticeSha256?: string; total: number; acknowledged: number; recipients: Array<{ parliamentarianId: string; name: string; acknowledgedAt: string | null }> }>(`/sessions/${encodeURIComponent(sessionId)}/notice-recipients`),
  sessionDocuments: (sessionId: string) => request<{ documents: SessionDocumentView[] }>(`/sessions/${encodeURIComponent(sessionId)}/documents`),
  uploadSessionDocument: async (sessionId: string, kind: SessionDocumentView['kind'], file: File) => {
    const form = new FormData()
    form.set('kind', kind)
    form.set('file', file)
    const headers = new Headers()
    const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
    if (actorId) headers.set('x-actor-id', actorId)
    const response = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/documents`, { method: 'POST', headers, body: form })
    const result = await response.json()
    if (!response.ok) throw new ApiRequestError(result as ApiError)
    return result as { document: SessionDocumentView }
  },
  downloadSessionDocument: async (sessionId: string, documentId: string) => {
    const headers = new Headers()
    const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
    if (actorId) headers.set('x-actor-id', actorId)
    const response = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/documents/${encodeURIComponent(documentId)}`, { headers })
    if (!response.ok) throw new ApiRequestError(await response.json() as ApiError)
    return response.blob()
  },
  noticeDeliveries: (sessionId: string, revision?: number) => request<{ revision: number | null; noticeSha256?: string; deliveries: NoticeDeliveryView[] }>(`/sessions/${encodeURIComponent(sessionId)}/notice-deliveries${revision ? `?revision=${revision}` : ''}`),
  attestNoticeDelivery: (sessionId: string, data: { revision: number; noticeSha256: string; parliamentarianId: string; channel: NoticeDeliveryView['channel']; evidenceReference: string; deliveredAt: string; commandId: string; acknowledged: true }) =>
    request<{ delivery: NoticeDeliveryView; mode: 'manual_attestation' }>(`/sessions/${encodeURIComponent(sessionId)}/notice-deliveries`, { method: 'POST', body: JSON.stringify(data) }),
  noticeRecipientPreview: (sessionId: string) => request<{ policy: 'active' | 'mandate_and_leave'; total: number; recipients: Array<{ id: string; name: string }> }>(`/sessions/${encodeURIComponent(sessionId)}/notice-recipient-preview`),
  meCheckIn: (note?: string, commandId = crypto.randomUUID(), sessionId?: string) =>
    request<{
      attendance: { status: string; present: boolean; lastEventAt: string | null }
      quorum: QuorumInfo
    }>('/me/check-in', {
      method: 'POST',
      body: JSON.stringify({ note, commandId, sessionId }),
    }),
  meVote: (votingId: string, value: VoteValue | string, commandId: string) =>
    request<{
      vote: { value: string | null; receivedAt: string | null; changedAt: string | null }
      registeredCount: number
      /** Fase 18: recibo verificável pendente (emitido no encerramento). */
      receiptPending?: boolean
    }>('/me/vote', {
      method: 'POST',
      body: JSON.stringify({ votingId, value, commandId }),
    }),
  meSpeech: (data: {
    kind: 'grande_expediente' | 'explicacoes_pessoais' | 'consideracoes_finais' | 'homenagem' | 'ordem'
    subject?: string
    side?: 'situacao' | 'oposicao' | 'neutro'
  }) =>
    request<{ speech: { id: string; status: string; position: number; total: number } }>('/me/speech', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  meHistory: () => request<MeHistoryView>('/me/history'),
  /** Fase 18 — recibos verificáveis do próprio parlamentar. */
  meReceipts: () => request<{ receipts: MyVoteReceiptRow[] }>('/me/receipts'),
}

export const platformApi = {
  overview: () => request<{ overview: PlatformOverviewView }>('/platform/overview'),
  listTenants: () => request<{ tenants: TenantConsoleView[] }>('/platform/tenants'),
  createTenant: (data: { name: string; slug: string; city: string; uf: string; planId: string }) =>
    request<{ tenant: TenantConsoleView }>('/platform/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTenant: (id: string, data: { active?: boolean; planId?: string }) =>
    request<{ tenant: TenantConsoleView }>(`/platform/tenants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  listPlans: () => request<{ plans: PlanView[] }>('/platform/plans'),
  createPlan: (data: { name: string; priceCents: number; limits?: Record<string, unknown> }) =>
    request<{ plan: PlanView }>('/platform/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updatePlan: (id: string, data: { active?: boolean; priceCents?: number; limits?: Record<string, unknown> }) =>
    request<{ plan: PlanView }>(`/platform/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

export const migrationApi = {
  runStage: (stage: string, runId?: string) =>
    request<{ run: MigrationRunView }>('/migration/run', {
      method: 'POST',
      body: JSON.stringify(runId ? { stage, runId } : { stage }),
    }),
  listRuns: () => request<{ runs: MigrationRunView[] }>('/migration/runs'),
  getRun: (id: string) => request<{ run: MigrationRunView }>(`/migration/runs/${id}`),
  homologate: (id: string, confirmation = 'HOMOLOGAR', note?: string) =>
    request<{ run: MigrationRunView }>(`/migration/runs/${id}/homologate`, {
      method: 'POST',
      body: JSON.stringify({ confirmation, note }),
    }),
}

// v0.12.0 — Planejamento e Roadmap (Onda 5)
export const roadmapApi = {
  content: () => request<RoadmapContent>('/roadmap'),
  setTaskStatus: (taskId: string, status: RoadmapTaskStatus) =>
    request<{ task: RoadmapTaskView }>(`/roadmap/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
}

// ─── Onda 5 / Fase 21 — Agendamentos da plataforma ─────────────────────────
export const schedulesApi = {
  list: () => request<{ jobs: ScheduledJobView[] }>('/platform/schedules'),
  run: (id: string) =>
    request<{ job: ScheduledJobView }>(`/platform/schedules/${id}/run`, { method: 'POST' }),
  update: (id: string, data: { active?: boolean; everySeconds?: number }) =>
    request<{ job: ScheduledJobView }>(`/platform/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

// ─── Onda 5 / Fase 22 — MFA, sessões ativas e assinatura de atas ───────────
export const mfaApi = {
  setup: () => request<MfaSetupView>('/auth/mfa/setup', { method: 'POST' }),
  enable: (totp: string) =>
    request<{ ok: true }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ totp }) }),
  disable: (password: string, totp: string) =>
    request<{ ok: true }>('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password, totp }),
    }),
  /** Login 2 passos: senha correta + código TOTP válido → sessão. */
  login: (email: string, password: string, totp: string) =>
    request<{ actor: unknown }>('/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp }),
    }),
}

export const authSessionsApi = {
  list: () => request<{ sessions: AuthSessionView[] }>('/auth/sessions'),
  revoke: (id: string) => request<{ ok: true }>(`/auth/sessions/${id}`, { method: 'DELETE' }),
}

export const signaturesApi = {
  /** POST /me/ata/sign — parlamentar assina a ata da última sessão encerrada. */
  signAta: () => request<{ signature: DocumentSignatureView }>('/me/ata/sign', { method: 'POST' }),
  /** Painel de assinaturas da ata da sessão (Relatórios / Mesa). */
  ataPanel: (sessionId: string) =>
    request<AtaSignaturesView>(`/reports/session/${sessionId}/ata/signatures`),
  /** Ata pública com assinaturas (Portal Público). */
  publicAta: (tenantSlug: string, sessionId: string) =>
    request<PublicAtaView>(`/public/documents/ata/${sessionId}?tenant=${encodeURIComponent(tenantSlug)}`),
  /** Verificação pública de assinatura por código (rate limited). */
  verifySignature: (code: string) =>
    request<SignatureVerificationView>(
      `/public/documents/verify-signature?code=${encodeURIComponent(code.trim().toUpperCase())}`
    ),
}

// ─── Onda 5 / Fase 23 — Chaves de API + playground ─────────────────────────
export const apiKeysApi = {
  list: () => request<{ keys: ApiKeyView[] }>('/api-keys'),
  create: (data: { name: string; scopes: ApiScope[] }) =>
    request<ApiKeyCreatedView>('/api-keys', { method: 'POST', body: JSON.stringify(data) }),
  revoke: (id: string) => request<{ key: ApiKeyView }>(`/api-keys/${id}`, { method: 'DELETE' }),
  /** Executa uma consulta REAL server-side com a chave selecionada (nunca exposta ao browser). */
  playground: (data: { keyId: string; endpoint: string }) =>
    request<{ result: PlaygroundResultView }>('/api-keys/playground', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ─── Onda 5 / Fase 24 — Crescimento (onboarding/health/métricas/NPS) ───────
export const growthApi = {
  onboardingRequests: () => request<{ requests: OnboardingRequestView[] }>('/platform/onboarding'),
  activate: (id: string) =>
    request<OnboardingActivationView>(`/platform/onboarding/${id}/activate`, { method: 'POST' }),
  reject: (id: string, note: string) =>
    request<{ request: OnboardingRequestView }>(`/platform/onboarding/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  /** Health atual (recomputado na hora) de todos os tenants ativos. */
  tenantsHealth: () => request<{ tenants: TenantHealthView[] }>('/platform/tenants/health'),
  /** Health detalhado + captura forçada de snapshot de UM tenant. */
  captureHealth: (tenantId: string) =>
    request<TenantHealthView>(`/platform/tenants/${tenantId}/health`, { method: 'POST' }),
  metrics: () => request<PlatformMetricsView>('/platform/metrics'),
  /** NPS do próprio usuário na versão atual (widget da Central de Ajuda). */
  myNps: () => request<MyNpsView>('/help/nps'),
  submitNps: (score: number, comment?: string) =>
    request<MyNpsView>('/help/nps', {
      method: 'POST',
      body: JSON.stringify({ score, comment: comment ?? null }),
    }),
}
