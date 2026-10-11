/**
 * Serializadores: linhas do banco → tipos View de src/lib/contracts.ts
 * (datas ISO string, null quando nulo, derivados computados).
 */
import type {
  AgendaItemView,
  ActorView,
  AuditView,
  MatterView,
  ParliamentarianView,
  SessionSummary,
  SessionType,
  SpeechView,
  TenantView,
  VotingView,
  VoteRow,
  VoteValue,
  VoteValueOrEmpty,
  ResultCounts,
  Role,
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
  MatterRef,
  MatterRelatedKind,
  MatterOutcomeKind,
  RelatedMatterView,
  MatterOutcomeView,
} from '@/lib/contracts'
import { MATTER_TYPE_SHORT, SESSION_TYPE_LABEL } from '@/lib/contracts'
import type {
  Prisma,
  PrismaClient,
  AgendaItem as AgendaItemRow,
  AuditEvent as AuditEventRow,
  LegislativeMatter as MatterRow,
  Parliamentarian as ParlRow,
  Session as SessionRow,
  Speech as SpeechRow,
  Tenant as TenantRow,
  User,
  Vote as VoteRow_,
  Voting as VotingRow,
  Legislature as LegislatureRow,
  Party as PartyRow,
  Bloc as BlocRow,
  BoardPosition as BoardPositionRow,
  Committee as CommitteeRow,
  CommitteeMember as CommitteeMemberRow,
  CommitteeMeeting as CommitteeMeetingRow,
  Leave as LeaveRow,
  Mandate as MandateRow,
  MatterTypeConfig as MatterTypeConfigRow,
  Proceeding as ProceedingRow,
  MatterVersion as MatterVersionRow,
  MatterAttachment as MatterAttachmentRow,
  ProtocolEntry as ProtocolEntryRow,
  LegislativeTask as LegislativeTaskRow,
  RelatedMatter as RelatedMatterRow,
  MatterOutcome as MatterOutcomeRow,
  VotingOption as VotingOptionRow,
} from '@prisma/client'
import { tenantSettings, currentAttendance } from './domain'

type Tx = Prisma.TransactionClient | PrismaClient

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null)

// ─── Tenant / atores ────────────────────────────────────────────────────────

export function toTenantView(tenant: TenantRow, activeParliamentarians = 0): TenantView {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    city: tenant.city,
    uf: tenant.uf,
    plan: tenant.plan,
    primaryColor: tenant.primaryColor,
    accentColor: tenant.accentColor,
    logoUrl: tenant.logoUrl ?? null,
    timezone: tenant.timezone,
    settings: tenantSettings(tenant, activeParliamentarians),
    trialEndsAt: tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toISOString() : null,
  }
}

export function toActorView(user: User): ActorView {
  return {
    id: user.id,
    name: user.name,
    role: user.role as Role,
    jobTitle: user.jobTitle ?? null,
    parliamentarianId: user.parliamentarianId ?? null,
  }
}

// ─── Matérias / parlamentares ───────────────────────────────────────────────

export function parseAuthors(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function matterLabel(matter: MatterRow | null | undefined): string | null {
  if (!matter) return null
  return `${MATTER_TYPE_SHORT[matter.type as keyof typeof MATTER_TYPE_SHORT] ?? 'MAT'} ${matter.number}/${matter.year}`
}

export function toMatterView(m: MatterRow): MatterView {
  return {
    id: m.id,
    type: m.type as MatterView['type'],
    number: m.number,
    year: m.year,
    ementa: m.ementa,
    authors: parseAuthors(m.authors),
    status: m.status as MatterView['status'],
    regime: m.regime as MatterView['regime'],
    createdAt: iso(m.createdAt) as string,
  }
}

// ─── Fase 17: ciclo de vida (relacionamentos + desfechos) ──────────────────

/** Referência curta a outra matéria (a "outra ponta" de um vínculo). */
export function toMatterRef(m: MatterRow): MatterRef {
  return {
    id: m.id,
    type: m.type as MatterRef['type'],
    number: m.number,
    year: m.year,
    ementa: m.ementa,
    status: m.status as MatterRef['status'],
  }
}

/** Rótulo "PL 44/2026" de um MatterRef/MatterRow (mesma regra do matterLabel). */
export function matterRefLabel(m: { type: string; number: number; year: number }): string {
  return `${MATTER_TYPE_SHORT[m.type as keyof typeof MATTER_TYPE_SHORT] ?? 'MAT'} ${m.number}/${m.year}`
}

/** RelatedMatter com as duas pontas populadas (include do Prisma). */
export type RelatedMatterWithEnds = RelatedMatterRow & {
  matter: MatterRow
  relatedMatter: MatterRow
}

/**
 * RelatedMatterRow → RelatedMatterView NA PERSPECTIVA da matéria indicada:
 * direction 'from' quando ela é a origem do vínculo (a outra ponta é o alvo)
 * e 'to' quando ela é o destino (a outra ponta é a origem).
 */
export function toRelatedMatterView(
  row: RelatedMatterWithEnds,
  perspectiveMatterId: string
): RelatedMatterView {
  const isFrom = row.matterId === perspectiveMatterId
  return {
    id: row.id,
    kind: row.kind as MatterRelatedKind,
    notes: row.notes ?? null,
    direction: isFrom ? 'from' : 'to',
    matter: toMatterRef(isFrom ? row.relatedMatter : row.matter),
  }
}

export function toMatterOutcomeView(o: MatterOutcomeRow): MatterOutcomeView {
  return {
    id: o.id,
    kind: o.kind as MatterOutcomeKind,
    actorName: o.actorName,
    date: iso(o.date) as string,
    notes: o.notes ?? null,
    dueAt: iso(o.dueAt),
  }
}

export function toParliamentarianView(p: ParlRow): ParliamentarianView {
  return {
    id: p.id,
    name: p.name,
    party: p.party,
    bloc: p.bloc ?? null,
    boardRole: p.boardRole,
    committee: p.committee ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    photoUrl: p.photoUrl ?? null,
    partyEmblemUrl: p.partyEmblemUrl ?? null,
    active: p.active,
  }
}

// ─── Sessões ────────────────────────────────────────────────────────────────

export function toAgendaItemView(item: AgendaItemRow & { matter?: MatterRow | null }): AgendaItemView {
  return {
    id: item.id,
    order: item.order,
    section: item.section as AgendaItemView['section'],
    title: item.title,
    matterId: item.matterId ?? null,
    matterType: (item.matter?.type as AgendaItemView['matterType']) ?? null,
    matterLabel: matterLabel(item.matter),
    kind: item.kind as AgendaItemView['kind'],
    status: item.status as AgendaItemView['status'],
    resultSummary: item.resultSummary ?? null,
  }
}

export function toSessionSummary(
  session: SessionRow,
  derived: { presentCount: number; agendaCount: number; totalMembers: number }
): SessionSummary {
  return {
    id: session.id,
    number: session.number,
    year: session.year,
    type: session.type as SessionType,
    scheduledAt: iso(session.scheduledAt) as string,
    openedAt: iso(session.openedAt),
    closedAt: iso(session.closedAt),
    status: session.status as SessionSummary['status'],
    presidentName: session.presidentName ?? null,
    presidentId: session.presidentId ?? null,
    secretaryName: session.secretaryName ?? null,
    location: session.location,
    agendaPublished: session.agendaPublished,
    agendaCount: derived.agendaCount,
    presentCount: derived.presentCount,
    totalMembers: derived.totalMembers,
    version: session.version,
    notes: session.notes ?? null,
  }
}

/** Rótulo público da sessão ("Sessão Ordinária nº 2/2025"). */
export function sessionLabel(session: SessionRow): string {
  return `${SESSION_TYPE_LABEL[session.type as SessionType] ?? 'Sessão'} nº ${session.number}/${session.year}`
}

/**
 * Lista de SessionSummary com derivados (presentCount por último evento de
 * presença, agendaCount, totalMembers) — consultas em lote.
 */
export async function buildSessionSummaries(
  client: Tx,
  tenantId: string,
  sessions: SessionRow[]
): Promise<SessionSummary[]> {
  if (sessions.length === 0) return []
  const ids = sessions.map((s) => s.id)
  const [parliamentarians, agendaCounts, events] = await Promise.all([
    client.parliamentarian.findMany({
      where: { tenantId, active: true },
      select: { id: true },
    }),
    client.agendaItem.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: ids } },
      _count: { _all: true },
    }),
    client.attendanceEvent.findMany({ where: { sessionId: { in: ids } } }),
  ])
  const activeIds = new Set(parliamentarians.map((p) => p.id))
  const agendaBySession = new Map(agendaCounts.map((g) => [g.sessionId, g._count._all]))
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const lastBySessionParl = new Map<string, string>()
  for (const ev of sorted) {
    lastBySessionParl.set(`${ev.sessionId}:${ev.parliamentarianId}`, ev.status)
  }
  const presentBySession = new Map<string, number>()
  for (const [key, status] of lastBySessionParl) {
    if (status !== 'presente') continue
    const [sessionId, parlId] = key.split(':')
    if (!activeIds.has(parlId)) continue
    presentBySession.set(sessionId, (presentBySession.get(sessionId) ?? 0) + 1)
  }
  return sessions.map((s) =>
    toSessionSummary(s, {
      presentCount: presentBySession.get(s.id) ?? 0,
      agendaCount: agendaBySession.get(s.id) ?? 0,
      totalMembers: activeIds.size,
    })
  )
}

// ─── Votações ───────────────────────────────────────────────────────────────

export function toVoteRow(vote: VoteRow_ & { parliamentarian: ParlRow }, secret = false): VoteRow {
  return {
    parliamentarianId: vote.parliamentarianId,
    name: vote.parliamentarian.name,
    party: vote.parliamentarian.party,
    value: secret ? null : (vote.value as VoteValue),
    receivedAt: iso(vote.receivedAt),
    changedAt: iso(vote.changedAt),
  }
}

export function parseResultCounts(raw: string | null): ResultCounts | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ResultCounts
  } catch {
    return null
  }
}

export function parseNominalDetail(
  raw: string | null
): Array<{ parliamentarianId: string; name: string; value: VoteValueOrEmpty; order: number }> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Votação com opções customizadas incluídas (Fase 18) — opcional no include. */
export type VotingWithOptions = VotingRow & { options?: VotingOptionRow[] }

export function toVotingOptionView(o: Pick<VotingOptionRow, 'key' | 'label' | 'order'>) {
  return { key: o.key, label: o.label, order: o.order }
}

/**
 * Votação SECRETA: lista quem votou (participação) sem revelar o valor (value: null).
 * Fase 18: inclui `options` (ordenadas por `order`; array vazio = padrão
 * sim/nao/abstencao) quando o caller as incluiu na consulta.
 */
export function toVotingView(
  voting: VotingWithOptions,
  votes: Array<VoteRow_ & { parliamentarian: ParlRow }> = []
): VotingView {
  const secret = voting.mode === 'secreto'
  return {
    id: voting.id,
    sessionId: voting.sessionId,
    agendaItemId: voting.agendaItemId ?? null,
    matterId: voting.matterId ?? null,
    question: voting.question,
    mode: voting.mode as VotingView['mode'],
    status: voting.status as VotingView['status'],
    rule: voting.rule as VotingView['rule'],
    openedAt: iso(voting.openedAt),
    closedAt: iso(voting.closedAt),
    hidePartial: voting.hidePartial,
    options: [...(voting.options ?? [])]
      .sort((a, b) => a.order - b.order)
      .map(toVotingOptionView),
    presentAtOpen: voting.presentAtOpen ?? null,
    requiredQuorum: voting.requiredQuorum ?? null,
    memberBaseAtOpen: voting.memberBaseAtOpen ?? null,
    eligibleVoterIdsAtOpen: voting.eligibleVoterIdsAtOpen ? JSON.parse(voting.eligibleVoterIdsAtOpen) as string[] : null,
    impedimentPolicyAtOpen: (voting.impedimentPolicyAtOpen as VotingView['impedimentPolicyAtOpen']) ?? null,
    presentAtClose: voting.presentAtClose ?? null,
    resultStatus: (voting.resultStatus as VotingView['resultStatus']) ?? null,
    resultCounts: parseResultCounts(voting.resultCounts),
    votes: votes.map((v) => toVoteRow(v, secret)),
    registeredCount: votes.length,
    version: voting.version,
    justification: voting.justification ?? null,
  }
}

// ─── Discursos ──────────────────────────────────────────────────────────────

export function speechElapsedSeconds(speech: SpeechRow, now = new Date()): number {
  if (speech.status === 'falando' && speech.startedAt) {
    const delta = Math.max(0, Math.round((now.getTime() - new Date(speech.startedAt).getTime()) / 1000))
    return speech.elapsedSeconds + delta
  }
  return speech.elapsedSeconds
}

export function toSpeechView(speech: SpeechRow & { parliamentarian?: ParlRow | null }): SpeechView {
  const speakerName =
    speech.parliamentarian?.name ?? speech.externalSpeaker ?? 'Orador externo'
  return {
    id: speech.id,
    sessionId: speech.sessionId,
    speakerName,
    parliamentarianId: speech.parliamentarianId ?? null,
    kind: speech.kind,
    subject: speech.subject ?? null,
    side: (speech.side as SpeechView['side']) ?? null,
    status: speech.status as SpeechView['status'],
    plannedSeconds: speech.plannedSeconds,
    elapsedSeconds: speechElapsedSeconds(speech),
    startedAt: iso(speech.startedAt),
    pausedAt: iso(speech.pausedAt),
    finishedAt: iso(speech.finishedAt),
  }
}

// ─── Auditoria ──────────────────────────────────────────────────────────────

export function toAuditView(ev: AuditEventRow): AuditView {
  return {
    id: ev.id,
    actorName: ev.actorName,
    actorRole: ev.actorRole,
    action: ev.action,
    aggregateType: ev.aggregateType,
    aggregateId: ev.aggregateId ?? null,
    summary: ev.summary,
    beforeValue: ev.beforeValue ?? null,
    afterValue: ev.afterValue ?? null,
    justification: ev.justification ?? null,
    correlationId: ev.correlationId ?? null,
    ip: ev.ip ?? null,
    createdAt: iso(ev.createdAt) as string,
    chainHash: ev.chainHash,
    prevHash: ev.prevHash ?? null,
  }
}

// ─── Detalhe completo da sessão (SessionDetail) ─────────────────────────────

/** Monta o SessionDetail completo (agenda, presença/quórum, votações, discursos). */
export async function buildSessionDetail(
  client: Tx,
  session: SessionRow
): Promise<import('@/lib/contracts').SessionDetail> {
  const [agenda, attendance, votings, speeches] = await Promise.all([
    client.agendaItem.findMany({
      where: { sessionId: session.id },
      orderBy: { order: 'asc' },
      include: { matter: true },
    }),
    currentAttendance(client, session.id, session.tenantId),
    client.voting.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      include: {
        votes: { include: { parliamentarian: true } },
        options: { orderBy: { order: 'asc' } },
      },
    }),
    client.speech.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      include: { parliamentarian: true },
    }),
  ])

  // votos ordenados por bancada (ordem do parlamentar); registeredCount = total
  const withVotesOrdered = votings.map((v) => ({
    ...v,
    votes: [...v.votes].sort((a, b) => a.parliamentarian.order - b.parliamentarian.order),
  }))
  const activeVoting = [...votings].reverse().find((v) => v.status === 'open' || v.status === 'paused')
  const votingAttendance = activeVoting?.eligibleVoterIdsAtOpen
    ? await currentAttendance(client, session.id, session.tenantId, JSON.parse(activeVoting.eligibleVoterIdsAtOpen) as string[])
    : attendance
  const required = activeVoting?.quorumAtOpen ?? activeVoting?.requiredQuorum ?? votingAttendance.quorum.required

  const [summary] = await buildSessionSummaries(client, session.tenantId, [session])
  return {
    session: summary,
    agenda: agenda.map(toAgendaItemView),
    attendance: votingAttendance.rows,
    quorum: { ...votingAttendance.quorum, required, ok: votingAttendance.quorum.present >= required },
    votings: withVotesOrdered.map((v) => toVotingView(v, v.votes)),
    speeches: speeches.map(toSpeechView),
  }
}


// ─── Fase 5: Estrutura institucional & processo legislativo ─────────────────

export function toLegislatureView(l: LegislatureRow): LegislatureView {
  return {
    id: l.id,
    number: l.number,
    startYear: l.startYear,
    endYear: l.endYear,
    current: l.current,
  }
}

export function toPartyView(p: PartyRow): PartyView {
  return { id: p.id, acronym: p.acronym, name: p.name, number: p.number ?? null, active: p.active }
}

export function parseAcronyms(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function toBlocView(b: BlocRow): BlocView {
  return { id: b.id, name: b.name, partyAcronyms: parseAcronyms(b.partyAcronyms), active: b.active }
}

export function toBoardPositionView(
  bp: BoardPositionRow & { parliamentarian: ParlRow; legislature: LegislatureRow }
): BoardPositionView {
  return {
    id: bp.id,
    legislatureId: bp.legislatureId,
    legislatureNumber: bp.legislature.number,
    role: bp.role,
    parliamentarianId: bp.parliamentarianId,
    parliamentarianName: bp.parliamentarian.name,
    parliamentarianParty: bp.parliamentarian.party,
    startDate: iso(bp.startDate) as string,
    endDate: iso(bp.endDate),
    current: bp.endDate === null,
  }
}

export function toCommitteeView(c: CommitteeRow, activeMemberCount = 0): CommitteeView {
  return {
    id: c.id,
    name: c.name,
    acronym: c.acronym,
    kind: c.kind,
    description: c.description ?? null,
    active: c.active,
    activeMemberCount,
  }
}

export function toCommitteeMemberView(m: CommitteeMemberRow & { parliamentarian: ParlRow }): CommitteeMemberView {
  return {
    id: m.id,
    committeeId: m.committeeId,
    parliamentarianId: m.parliamentarianId,
    parliamentarianName: m.parliamentarian.name,
    parliamentarianParty: m.parliamentarian.party,
    role: m.role,
    startDate: iso(m.startDate) as string,
    endDate: iso(m.endDate),
    current: m.endDate === null,
  }
}

export function toCommitteeMeetingView(m: CommitteeMeetingRow & { committee: { acronym: string } }): CommitteeMeetingView {
  return {
    id: m.id,
    committeeId: m.committeeId,
    committeeAcronym: m.committee.acronym,
    scheduledAt: iso(m.scheduledAt) as string,
    subject: m.subject,
    status: m.status,
    notes: m.notes ?? null,
  }
}

export function toLeaveView(
  l: LeaveRow & { parliamentarian: ParlRow; substitute?: ParlRow | null }
): LeaveView {
  return {
    id: l.id,
    parliamentarianId: l.parliamentarianId,
    parliamentarianName: l.parliamentarian.name,
    kind: l.kind,
    startDate: iso(l.startDate) as string,
    endDate: iso(l.endDate),
    reason: l.reason,
    substituteId: l.substituteId ?? null,
    substituteName: l.substitute?.name ?? null,
    current: l.endDate === null,
  }
}

export function toMandateView(
  m: MandateRow & { parliamentarian: ParlRow; legislature: LegislatureRow }
): MandateView {
  return {
    id: m.id,
    parliamentarianId: m.parliamentarianId,
    parliamentarianName: m.parliamentarian.name,
    parliamentarianParty: m.parliamentarian.party,
    legislatureId: m.legislatureId,
    legislatureNumber: m.legislature.number,
    startDate: iso(m.startDate) as string,
    endDate: iso(m.endDate),
    votes: m.votes ?? null,
  }
}

export function toMatterTypeConfigView(mt: MatterTypeConfigRow): MatterTypeConfigView {
  return {
    id: mt.id,
    code: mt.code,
    name: mt.name,
    defaultRegime: mt.defaultRegime,
    active: mt.active,
  }
}

export function toProceedingView(p: ProceedingRow): ProceedingView {
  return {
    id: p.id,
    matterId: p.matterId,
    seq: p.seq,
    action: p.action,
    fromStatus: p.fromStatus,
    toStatus: p.toStatus,
    actorName: p.actorName,
    actorRole: p.actorRole,
    notes: p.notes ?? null,
    documentRef: p.documentRef ?? null,
    dueAt: iso(p.dueAt),
    createdAt: iso(p.createdAt) as string,
  }
}

export function toMatterVersionView(v: MatterVersionRow): MatterVersionView {
  return {
    id: v.id,
    matterId: v.matterId,
    version: v.version,
    text: v.text,
    authorName: v.authorName,
    createdAt: iso(v.createdAt) as string,
  }
}

export function toMatterAttachmentView(a: MatterAttachmentRow): MatterAttachmentView {
  return {
    id: a.id,
    matterId: a.matterId,
    name: a.name,
    kind: a.kind,
    sizeBytes: a.sizeBytes,
    url: a.url ?? null,
    createdAt: iso(a.createdAt) as string,
  }
}

export function toProtocolEntryView(p: ProtocolEntryRow): ProtocolEntryView {
  return {
    id: p.id,
    number: p.number,
    year: p.year,
    kind: p.kind,
    senderName: p.senderName,
    subject: p.subject,
    matterId: p.matterId ?? null,
    status: p.status,
    notes: p.notes ?? null,
    createdAt: iso(p.createdAt) as string,
    updatedAt: iso(p.updatedAt) as string,
  }
}

export function toLegislativeTaskView(
  t: LegislativeTaskRow,
  matter?: MatterRow | null
): LegislativeTaskView {
  return {
    id: t.id,
    matterId: t.matterId ?? null,
    matterLabel: matterLabel(matter ?? null),
    title: t.title,
    kind: t.kind,
    dueAt: iso(t.dueAt) as string,
    status: t.status,
    assigneeName: t.assigneeName ?? null,
    overdue: t.status === 'pendente' && t.dueAt.getTime() < Date.now(),
    createdAt: iso(t.createdAt) as string,
    updatedAt: iso(t.updatedAt) as string,
  }
}
