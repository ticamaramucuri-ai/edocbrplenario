/**
 * GET /api/v1/public/open-data?dataset=matters|sessions|attendance|votes&format=json|csv
 * Dados abertos SOMENTE de dados publicáveis (LAI/LGPD):
 *  - matters: todas as matérias do tenant;
 *  - sessions: sessões com resultados agregados;
 *  - attendance: presença consolidada por sessão ENCERRADA;
 *  - votes: resultados por votação — SEM detalhe nominal de votação secreta.
 * format=json (padrão; inclui generatedAt e tenant) | csv (";" + BOM UTF-8,
 * Content-Disposition: attachment).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { toMatterPublicView, publicNominalDetail } from '@/lib/server/public-serializers'
import { parseResultCounts } from '@/lib/server/serializers'
import type { ResultCounts, VoteValueOrEmpty } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

type CsvRow = Record<string, string | number | null>

const DATASETS = ['matters', 'sessions', 'attendance', 'votes'] as const
type Dataset = (typeof DATASETS)[number]

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(';'), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(';'))]
  return `\uFEFF${lines.join('\r\n')}`
}

const fmt = (d: Date | null): string => (d ? d.toISOString() : '')

function nominalToText(
  nominal: Array<{ name: string; party: string; value: VoteValueOrEmpty }> | null
): string {
  if (!nominal) return ''
  return nominal.map((n) => `${n.name} (${n.party}): ${n.value}`).join(' | ')
}

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))
  const params = req.nextUrl.searchParams
  const dataset = (params.get('dataset')?.trim() || '') as Dataset
  if (!DATASETS.includes(dataset)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      `Parâmetro dataset inválido ("${dataset}"). Valores aceitos: ${DATASETS.join(', ')}.`,
      { errors: { dataset: [`Use um de: ${DATASETS.join(', ')}.`] } }
    )
  }
  const format = params.get('format')?.trim() === 'csv' ? 'csv' : 'json'
  const generatedAt = new Date()

  // ── dataset: matters ──────────────────────────────────────────────────
  if (dataset === 'matters') {
    const matters = await db.legislativeMatter.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ type: 'asc' }, { number: 'desc' }, { year: 'desc' }],
    })
    if (format === 'csv') {
      const rows: CsvRow[] = matters.map((m) => {
        const v = toMatterPublicView(m)
        return {
          id: v.id,
          tipo: v.type,
          numero: v.number,
          ano: v.year,
          ementa: v.ementa,
          autores: v.authors.join(', '),
          situacao: v.status,
          regime: v.regime,
          criadaEm: v.createdAt,
        }
      })
      return new Response(toCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="dados-abertos-materias-${tenant.slug}.csv"`,
        },
      })
    }
    return Response.json({
      dataset,
      tenant: { slug: tenant.slug, name: tenant.name, city: tenant.city, uf: tenant.uf },
      generatedAt: generatedAt.toISOString(),
      matters: matters.map(toMatterPublicView),
    })
  }

  // ── dataset: sessions (lista com resultados) ──────────────────────────
  if (dataset === 'sessions') {
    const sessions = await db.session.findMany({
      where: { tenantId: tenant.id, status: { not: 'draft' } },
      orderBy: { scheduledAt: 'desc' },
      include: { votings: { where: { status: 'closed', resultStatus: { not: null } } } },
    })
    const data = sessions.map((s) => ({
      id: s.id,
      number: s.number,
      year: s.year,
      type: s.type,
      scheduledAt: s.scheduledAt.toISOString(),
      status: s.status,
      agendaPublished: s.agendaPublished,
      results: s.votings.map((v) => ({
        question: v.question,
        mode: v.mode,
        resultStatus: v.resultStatus,
        counts: parseResultCounts(v.resultCounts),
      })),
    }))
    if (format === 'csv') {
      const rows: CsvRow[] = sessions.map((s) => ({
        id: s.id,
        numero: s.number,
        ano: s.year,
        tipo: s.type,
        dataHora: s.scheduledAt.toISOString(),
        situacao: s.status,
        pautaPublicada: s.agendaPublished ? 'sim' : 'não',
        votacoesEncerradas: s.votings.length,
        resultados: s.votings
          .map((v) => `${v.question.slice(0, 60)}: ${v.resultStatus}`)
          .join(' | '),
      }))
      return new Response(toCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="dados-abertos-sessoes-${tenant.slug}.csv"`,
        },
      })
    }
    return Response.json({
      dataset,
      tenant: { slug: tenant.slug, name: tenant.name, city: tenant.city, uf: tenant.uf },
      generatedAt: generatedAt.toISOString(),
      sessions: data,
    })
  }

  // ── dataset: attendance (presença consolidada de sessões encerradas) ──
  if (dataset === 'attendance') {
    const sessions = await db.session.findMany({
      where: { tenantId: tenant.id, status: 'closed' },
      orderBy: { scheduledAt: 'desc' },
      include: { attendanceEvents: true },
    })
    const parliamentarians = await db.parliamentarian.findMany({
      where: { tenantId: tenant.id, active: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    })
    const data = sessions.map((s) => {
      // Consolidado: último evento por parlamentar
      const lastBy = new Map<string, string>()
      const sorted = [...s.attendanceEvents].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )
      for (const ev of sorted) lastBy.set(ev.parliamentarianId, ev.status)
      const members = parliamentarians.map((p) => ({
        name: p.name,
        party: p.party,
        status: lastBy.get(p.id) ?? 'ausente',
      }))
      return {
        sessionId: s.id,
        number: s.number,
        year: s.year,
        type: s.type,
        scheduledAt: s.scheduledAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        presentCount: members.filter((m) => m.status === 'presente').length,
        totalMembers: parliamentarians.length,
        present: members
          .filter((m) => m.status === 'presente')
          .map((m) => `${m.name} (${m.party})`),
        members,
      }
    })
    if (format === 'csv') {
      const rows: CsvRow[] = []
      for (const s of data) {
        for (const m of s.members) {
          rows.push({
            sessao: `${s.number}/${s.year}`,
            dataHora: s.scheduledAt,
            parlamentar: m.name,
            partido: m.party,
            presenca: m.status,
          })
        }
      }
      return new Response(toCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="dados-abertos-presencas-${tenant.slug}.csv"`,
        },
      })
    }
    return Response.json({
      dataset,
      tenant: { slug: tenant.slug, name: tenant.name, city: tenant.city, uf: tenant.uf },
      generatedAt: generatedAt.toISOString(),
      attendance: data,
    })
  }

  // ── dataset: votes (resultados por votação, sigilo preservado) ─────────
  const votings = await db.voting.findMany({
    where: {
      status: 'closed',
      resultStatus: { not: null },
      session: { tenantId: tenant.id },
    },
    orderBy: { closedAt: 'desc' },
    include: { session: true, impediments: { where: { revokedAt: null }, select: { id: true } } },
  })
  const parliamentarians = await db.parliamentarian.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, party: true },
  })
  const partyById = new Map(parliamentarians.map((p) => [p.id, p.party]))
  const data = votings.map((v) => ({
    id: v.id,
    sessionId: v.sessionId,
    sessionNumber: v.session.number,
    sessionYear: v.session.year,
    question: v.question,
    mode: v.mode,
    rule: v.rule,
    resultStatus: v.resultStatus,
    counts: parseResultCounts(v.resultCounts) as ResultCounts | null,
    closedAt: v.closedAt ? v.closedAt.toISOString() : null,
    votingBasis: {
      presentAtOpen: v.presentAtOpen,
      presentAtClose: v.presentAtClose,
      requiredQuorum: v.quorumAtOpen ?? v.requiredQuorum,
      memberBaseAtOpen: v.memberBaseAtOpen,
      impedimentPolicyAtOpen: v.impedimentPolicyAtOpen,
      impedimentCount: v.impediments.length,
    },
    // Votação secreta: nominalDetail SEMPRE null (sigilo do valor individual).
    nominalDetail: publicNominalDetail(v, partyById),
  }))

  if (format === 'csv') {
    const rows: CsvRow[] = votings.map((v) => ({
      id: v.id,
      sessao: `${v.session.number}/${v.session.year}`,
      pergunta: v.question,
      modo: v.mode,
      regra: v.rule,
      resultado: v.resultStatus ?? '',
      sim: parseResultCounts(v.resultCounts)?.sim ?? 0,
      nao: parseResultCounts(v.resultCounts)?.nao ?? 0,
      abstencoes: parseResultCounts(v.resultCounts)?.abstencoes ?? 0,
      naoRegistraram: parseResultCounts(v.resultCounts)?.naoRegistraram ?? 0,
      presentes: parseResultCounts(v.resultCounts)?.presentes ?? 0,
      presentesAbertura: v.presentAtOpen,
      presentesEncerramento: v.presentAtClose,
      quorumExigido: v.quorumAtOpen ?? v.requiredQuorum,
      baseMaioriaAbsoluta: v.memberBaseAtOpen,
      politicaImpedimento: v.impedimentPolicyAtOpen,
      impedimentos: v.impediments.length,
      encerradaEm: fmt(v.closedAt),
      nominal: v.mode === 'secreto' ? 'VOTAÇÃO SECRETA — SIGILO PRESERVADO' : nominalToText(publicNominalDetail(v, partyById)),
    }))
    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dados-abertos-votacoes-${tenant.slug}.csv"`,
      },
    })
  }
  return Response.json({
    dataset,
    tenant: { slug: tenant.slug, name: tenant.name, city: tenant.city, uf: tenant.uf },
    generatedAt: generatedAt.toISOString(),
    votes: data,
  })
})
