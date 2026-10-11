/**
 * GET /api/v1/analytics/overview?year= — Fase 12: Analytics e BI Legislativo.
 *
 * Camada de LEITURA AGREGADA (nenhuma escrita no banco, nenhum modelo novo)
 * sobre dados já existentes: presenças, produção legislativa, tramitação,
 * votações e coesão partidária.
 *
 * RBAC: analytics.read (todos os papéis com escopo de tenant + platform_owner).
 * platform_owner pode usar `?tenant=slug` (resolveTenantScope).
 *
 * Regras de agregação (espelham a semântica já usada pelo sistema):
 * - Janela do ano: sessões com `scheduledAt` no ano (UTC) e status ≠ draft
 *   (rascunhos não contam nem como "agendadas"). Matérias: coluna `year`.
 * - "Sessão realizada" = status fechado OU em andamento
 *   (check_in | open | suspended | resumed | closed) — sessões agendadas
 *   futuras só entram na contagem de sessões do ano (sessionsByMonth.scheduled).
 * - Presença por sessão = ÚLTIMO AttendanceEvent do parlamentar na sessão com
 *   status final 'presente', restrita a parlamentares ATIVOS — exatamente a
 *   regra de deriveAttendance (domain.ts) / buildSessionSummaries
 *   (serializers.ts), replicada aqui de forma agregada.
 * - approvedMatters usa o status de matéria `aprovado` (domínio: aprovado é o
 *   único status terminal de aprovação; `arquivado` NÃO é aprovação).
 * - votingApprovalPct = votações com status 'closed' e resultStatus 'aprovado'
 *   ÷ votações 'closed' do ano (anuladas ficam fora de numerador e
 *   denominador). votingResults cobre todas as concluídas (closed + annulled).
 * - partyDiscipline: SOMENTE votações nominais encerradas (mode 'secreto' é
 *   inviolável e fica de fora; simbólicas não têm votos individuais). Por
 *   votação e partido: votos com valor não-nulo; voto majoritário = valor mais
 *   frequente (empate no topo = partido sem posição majoritária → 0 alinhados
 *   e todos os votos computados como analisados). Coesão ponderada por votos:
 *   Σ alinhados ÷ Σ analisados.
 * - proceedingsFlow: contagem por action usa andamentos criados no ano;
 *   avgDaysFromPrevious (por ação) e avgTotalDays usam o ciclo de vida
 *   completo das matérias do ano (primeiro→último andamento, ≥2 andamentos).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import {
  MATTER_STATUS_LABEL,
  MATTER_TYPE_LABEL,
  PROCEEDING_ACTION_LABEL,
} from '@/lib/contracts'

export const dynamic = 'force-dynamic'

// ─── Regras da janela ───────────────────────────────────────────────────────

/** Sessões "realizadas" (encerradas ou em andamento — presença/aprovação). */
const HELD_STATUSES = new Set(['check_in', 'open', 'suspended', 'resumed', 'closed'])

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const DAY_MS = 86_400_000

const round1 = (n: number): number => Math.round(n * 10) / 10

// ─── Tipos locais (payload de resposta) ─────────────────────────────────────

type Kpis = {
  sessionsHeld: number
  avgAttendancePct: number | null
  totalMatters: number
  approvedMatters: number
  votingApprovalPct: number | null
  avgProceedingDays: number | null
}

type AttendanceRankingRow = {
  parliamentarianId: string
  name: string
  party: string
  present: number
  total: number
  pct: number
}

type SessionMonthRow = { month: string; held: number; scheduled: number }

type StatusCountRow = { status: string; statusLabel: string; count: number }
type TypeCountRow = { type: string; typeLabel: string; count: number }

type TopAuthorRow = { name: string; count: number }

type VotingResults = {
  approved: number
  rejected: number
  draw: number
  annulled: number
  semQuorum: number
  total: number
}

type PartyDisciplineRow = {
  party: string
  cohesionPct: number
  votesAnalyzed: number
  votingsCount: number
}

type ProceedingsFlow = {
  items: Array<{ action: string; actionLabel: string; count: number; avgDaysFromPrevious: number | null }>
  avgTotalDays: number | null
}

type OverviewPayload = {
  year: number
  generatedAt: string
  kpis: Kpis
  attendanceRanking: AttendanceRankingRow[]
  sessionsByMonth: SessionMonthRow[]
  mattersByStatus: StatusCountRow[]
  mattersByType: TypeCountRow[]
  topAuthors: TopAuthorRow[]
  votingResults: VotingResults
  partyDiscipline: PartyDisciplineRow[]
  proceedingsFlow: ProceedingsFlow
}

// ─── Tipos das linhas carregadas (leitura via db, sem transação) ────────────

type SessionRow = { id: string; status: string; scheduledAt: Date }
type AttendanceEventRow = { sessionId: string; parliamentarianId: string; status: string; createdAt: Date }
type VoteRow = { value: string | null; parliamentarianId: string; parliamentarian: { party: string } }
type VotingRow = { id: string; mode: string; status: string; resultStatus: string | null; votes: VoteRow[] }
type MatterRow = { status: string; type: string; authors: string }
type ProceedingRow = { matterId: string; action: string; seq: number; createdAt: Date }

// ─── Handler ────────────────────────────────────────────────────────────────

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  // resolveTenantScope lê `?tenant=` via nextUrl — cast do Request do wrapper.
  const nextReq = req as NextRequest
  const actor = await resolveActor(req)
  requirePermission(actor, 'analytics.read')
  const tenantId = await resolveTenantScope(nextReq, actor)

  // year — default: ano atual (UTC); 2000–2100.
  const yearRaw = nextReq.nextUrl.searchParams.get('year')
  let year = new Date().getUTCFullYear()
  if (yearRaw !== null && yearRaw.trim() !== '') {
    const parsed = Number(yearRaw)
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      return Response.json(
        { detail: 'Parâmetro "year" deve ser um ano inteiro entre 2000 e 2100.' },
        { status: 422 }
      )
    }
    year = parsed
  }
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1))

  // Carregamento (read-only, volumes demo pequenos — agregação em memória).
  const [sessions, parliamentarians, matters, proceedings] = await Promise.all([
    db.session.findMany({
      where: { tenantId, status: { not: 'draft' }, scheduledAt: { gte: yearStart, lt: yearEnd } },
      select: { id: true, status: true, scheduledAt: true },
    }),
    db.parliamentarian.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true, party: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }),
    db.legislativeMatter.findMany({
      where: { tenantId, year },
      select: { status: true, type: true, authors: true },
    }),
    db.proceeding.findMany({
      where: { matter: { tenantId, year } },
      select: { matterId: true, action: true, seq: true, createdAt: true },
    }),
  ])

  const sessionIds = sessions.map((s) => s.id)
  const [attendanceEvents, votings]: [AttendanceEventRow[], VotingRow[]] = sessionIds.length
    ? await Promise.all([
        db.attendanceEvent.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { sessionId: true, parliamentarianId: true, status: true, createdAt: true },
        }),
        db.voting.findMany({
          where: { sessionId: { in: sessionIds } },
          select: {
            id: true,
            mode: true,
            status: true,
            resultStatus: true,
            votes: {
              select: {
                value: true,
                parliamentarianId: true,
                parliamentarian: { select: { party: true } },
              },
            },
          },
        }),
      ])
    : [[], []]

  // ─── Presença (regra idêntica à de deriveAttendance/buildSessionSummaries) ─
  const activeIds = new Set(parliamentarians.map((p) => p.id))
  const activeCount = activeIds.size
  const heldSessions = sessions.filter((s) => HELD_STATUSES.has(s.status))

  // Último evento por (sessão, parlamentar) — ordenação crescente por createdAt.
  const lastBySession = new Map<string, Map<string, string>>()
  for (const ev of [...attendanceEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!activeIds.has(ev.parliamentarianId)) continue
    let byParl = lastBySession.get(ev.sessionId)
    if (!byParl) {
      byParl = new Map()
      lastBySession.set(ev.sessionId, byParl)
    }
    byParl.set(ev.parliamentarianId, ev.status)
  }

  const presentByParl = new Map<string, number>()
  let attendancePctSum = 0
  for (const s of heldSessions) {
    const statuses = lastBySession.get(s.id)
    if (!statuses) {
      continue
    }
    let present = 0
    for (const [parlId, status] of statuses) {
      if (status !== 'presente') continue
      present += 1
      presentByParl.set(parlId, (presentByParl.get(parlId) ?? 0) + 1)
    }
    if (activeCount > 0) attendancePctSum += (present / activeCount) * 100
  }

  const totalHeld = heldSessions.length
  const attendanceRanking: AttendanceRankingRow[] = parliamentarians
    .map((p) => {
      const present = presentByParl.get(p.id) ?? 0
      return {
        parliamentarianId: p.id,
        name: p.name,
        party: p.party,
        present,
        total: totalHeld,
        pct: totalHeld > 0 ? round1((present / totalHeld) * 100) : 0,
      }
    })
    .sort(
      (a, b) =>
        b.pct - a.pct ||
        b.present - a.present ||
        a.name.localeCompare(b.name, 'pt-BR')
    )

  // ─── Sessões por mês ──────────────────────────────────────────────────────
  const sessionsByMonth: SessionMonthRow[] = MONTH_LABELS.map((month, idx) => ({
    month,
    scheduled: sessions.filter((s) => s.scheduledAt.getUTCMonth() === idx).length,
    held: heldSessions.filter((s) => s.scheduledAt.getUTCMonth() === idx).length,
  }))

  // ─── Matérias: status, tipo, autores ──────────────────────────────────────
  const statusCounts = new Map<string, number>()
  const typeCounts = new Map<string, number>()
  const authorCounts = new Map<string, number>()
  for (const m of matters) {
    statusCounts.set(m.status, (statusCounts.get(m.status) ?? 0) + 1)
    typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1)
    let authors: unknown = null
    try {
      authors = JSON.parse(m.authors)
    } catch {
      authors = null
    }
    if (Array.isArray(authors)) {
      for (const a of authors) {
        if (typeof a !== 'string') continue
        const name = a.trim()
        if (!name) continue
        authorCounts.set(name, (authorCounts.get(name) ?? 0) + 1)
      }
    }
  }
  const mattersByStatus: StatusCountRow[] = [...statusCounts.entries()]
    .map(([status, count]) => ({
      status,
      statusLabel: MATTER_STATUS_LABEL[status as keyof typeof MATTER_STATUS_LABEL] ?? status,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, 'pt-BR'))
  const mattersByType: TypeCountRow[] = [...typeCounts.entries()]
    .map(([type, count]) => ({
      type,
      typeLabel: MATTER_TYPE_LABEL[type as keyof typeof MATTER_TYPE_LABEL] ?? type,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'pt-BR'))
  const topAuthors: TopAuthorRow[] = [...authorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 10)

  // ─── Votações: resultados e taxa de aprovação ──────────────────────────────
  const concluded = votings.filter((v) => v.status === 'closed' || v.status === 'annulled')
  const votingResults: VotingResults = {
    approved: 0,
    rejected: 0,
    draw: 0,
    annulled: 0,
    semQuorum: 0,
    total: concluded.length,
  }
  for (const v of concluded) {
    if (v.status === 'annulled' || v.resultStatus === 'anulado') {
      votingResults.annulled += 1
      continue
    }
    switch (v.resultStatus) {
      case 'aprovado':
        votingResults.approved += 1
        break
      case 'rejeitado':
        votingResults.rejected += 1
        break
      case 'empate':
        votingResults.draw += 1
        break
      case 'sem_quorum':
        votingResults.semQuorum += 1
        break
      default:
        break
    }
  }
  const closedVotings = votings.filter((v) => v.status === 'closed')
  const approvedClosed = closedVotings.filter((v) => v.resultStatus === 'aprovado').length
  const votingApprovalPct =
    closedVotings.length > 0 ? round1((approvedClosed / closedVotings.length) * 100) : null

  // ─── Coesão partidária (somente votações NOMINAIS encerradas) ──────────────
  type PartyAcc = { aligned: number; analyzed: number; votings: number }
  const byParty = new Map<string, PartyAcc>()
  for (const v of votings) {
    if (v.status !== 'closed' || v.mode !== 'nominal') continue
    const valuesByParty = new Map<string, string[]>()
    for (const vote of v.votes) {
      // value nulo = participação sem valor (ex.: secreta) → fora do cálculo.
      if (!vote.value) continue
      const party = vote.parliamentarian?.party
      if (!party) continue
      const arr = valuesByParty.get(party) ?? []
      arr.push(vote.value)
      valuesByParty.set(party, arr)
    }
    for (const [party, values] of valuesByParty) {
      if (values.length === 0) continue
      const counts = new Map<string, number>()
      for (const val of values) counts.set(val, (counts.get(val) ?? 0) + 1)
      let max = 0
      for (const c of counts.values()) max = Math.max(max, c)
      const winners: string[] = []
      for (const [val, c] of counts) if (c === max) winners.push(val)
      // Maioria estrita: empate no topo = partido sem posição majoritária
      // (nenhum voto alinhado, todos contabilizados como analisados).
      const aligned = winners.length === 1 ? max : 0
      const acc = byParty.get(party) ?? { aligned: 0, analyzed: 0, votings: 0 }
      acc.aligned += aligned
      acc.analyzed += values.length
      acc.votings += 1
      byParty.set(party, acc)
    }
  }
  const partyDiscipline: PartyDisciplineRow[] = [...byParty.entries()]
    .map(([party, acc]) => ({
      party,
      cohesionPct: acc.analyzed > 0 ? round1((acc.aligned / acc.analyzed) * 100) : 0,
      votesAnalyzed: acc.analyzed,
      votingsCount: acc.votings,
    }))
    .sort(
      (a, b) =>
        b.cohesionPct - a.cohesionPct ||
        b.votesAnalyzed - a.votesAnalyzed ||
        a.party.localeCompare(b.party, 'pt-BR')
    )

  // ─── Tramitação (proceedings) ─────────────────────────────────────────────
  const procsByMatter = new Map<string, ProceedingRow[]>()
  for (const p of proceedings) {
    const arr = procsByMatter.get(p.matterId) ?? []
    arr.push(p)
    procsByMatter.set(p.matterId, arr)
  }
  const actionCounts = new Map<string, number>()
  const actionGaps = new Map<string, number[]>()
  const spanDays: number[] = []
  for (const list of procsByMatter.values()) {
    const sorted = [...list].sort(
      (a, b) => a.seq - b.seq || a.createdAt.getTime() - b.createdAt.getTime()
    )
    if (sorted.length >= 2) {
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      spanDays.push((last.createdAt.getTime() - first.createdAt.getTime()) / DAY_MS)
    }
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i].createdAt.getTime() - sorted[i - 1].createdAt.getTime()) / DAY_MS
      const arr = actionGaps.get(sorted[i].action) ?? []
      arr.push(gap)
      actionGaps.set(sorted[i].action, arr)
    }
  }
  // Contagem por ação: apenas andamentos criados dentro do ano.
  for (const p of proceedings) {
    const t = p.createdAt.getTime()
    if (t >= yearStart.getTime() && t < yearEnd.getTime()) {
      actionCounts.set(p.action, (actionCounts.get(p.action) ?? 0) + 1)
    }
  }
  const avgTotalDays =
    spanDays.length > 0 ? round1(spanDays.reduce((a, b) => a + b, 0) / spanDays.length) : null
  const proceedingsFlow: ProceedingsFlow = {
    items: [...actionCounts.entries()]
      .map(([action, count]) => {
        const gaps = actionGaps.get(action) ?? []
        return {
          action,
          actionLabel: PROCEEDING_ACTION_LABEL[action] ?? action,
          count,
          avgDaysFromPrevious:
            gaps.length > 0 ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
        }
      })
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action, 'pt-BR')),
    avgTotalDays,
  }

  // ─── Payload final ────────────────────────────────────────────────────────
  const payload: OverviewPayload = {
    year,
    generatedAt: new Date().toISOString(),
    kpis: {
      sessionsHeld: totalHeld,
      avgAttendancePct: totalHeld > 0 ? round1(attendancePctSum / totalHeld) : null,
      totalMatters: matters.length,
      approvedMatters: statusCounts.get('aprovado') ?? 0,
      votingApprovalPct,
      avgProceedingDays: avgTotalDays,
    },
    attendanceRanking,
    sessionsByMonth,
    mattersByStatus,
    mattersByType,
    topAuthors,
    votingResults,
    partyDiscipline,
    proceedingsFlow,
  }

  return Response.json(payload)
})
