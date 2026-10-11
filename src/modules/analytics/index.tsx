'use client'

/**
 * Módulo Analytics — Fase 12: indicadores de produtividade legislativa.
 *
 * Camada de leitura agregada sobre dados já existentes (presenças, produção
 * legislativa, tramitação, votações e coesão partidária) consumindo a rota
 * GET /api/v1/analytics/overview?year= (RBAC analytics.read).
 *
 * Gráficos via ChartContainer/ChartTooltip do shadcn (recharts) com as cores
 * do tema institucional (CSS vars --chart-1..5/--primary/--destructive —
 * verde/dourado, sem azul/indigo).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Award,
  BarChart3,
  CalendarCheck,
  Clock,
  Download,
  FileText,
  Gavel,
  GitBranch,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { ApiRequestError } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { ApiError } from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { exportCsv } from '@/modules/_shared'

// ─── Tipos do payload (espelham a rota /api/v1/analytics/overview) ──────────

type AnalyticsOverview = {
  year: number
  generatedAt: string
  kpis: {
    sessionsHeld: number
    avgAttendancePct: number | null
    totalMatters: number
    approvedMatters: number
    votingApprovalPct: number | null
    avgProceedingDays: number | null
  }
  attendanceRanking: Array<{
    parliamentarianId: string
    name: string
    party: string
    present: number
    total: number
    pct: number
  }>
  sessionsByMonth: Array<{ month: string; held: number; scheduled: number }>
  mattersByStatus: Array<{ status: string; statusLabel: string; count: number }>
  mattersByType: Array<{ type: string; typeLabel: string; count: number }>
  topAuthors: Array<{ name: string; count: number }>
  votingResults: {
    approved: number
    rejected: number
    draw: number
    annulled: number
    semQuorum: number
    total: number
  }
  partyDiscipline: Array<{
    party: string
    cohesionPct: number
    votesAnalyzed: number
    votingsCount: number
  }>
  proceedingsFlow: {
    items: Array<{
      action: string
      actionLabel: string
      count: number
      avgDaysFromPrevious: number | null
    }>
    avgTotalDays: number | null
  }
}

// ─── Fetch local (padrão do api-client: x-actor-id + Problem Details) ───────

async function fetchOverview(year: number): Promise<AnalyticsOverview> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(`/api/v1/analytics/overview?year=${year}`, { headers })
  const text = await res.text()
  const body = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const problem = (body ?? {
      type: 'about:blank',
      title: 'Erro de rede',
      status: res.status,
      detail: `Falha na requisição (${res.status})`,
      code: 'NETWORK_ERROR',
      correlationId: '—',
    }) as ApiError
    const err = new ApiRequestError(problem)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('legis:api-error', { detail: err }))
    }
    throw err
  }
  return body as AnalyticsOverview
}

// ─── Formatação pt-BR ───────────────────────────────────────────────────────

const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const fmtPct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${nf1.format(v)}%`
const fmtDays = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${nf1.format(v)} dias`

// ─── Cores por faixa de presença (verde ≥90 · padrão 70–89 · âmbar <70) ────

const bandFill = (pct: number): string =>
  pct >= 90 ? 'var(--chart-1)' : pct >= 70 ? 'var(--primary)' : 'var(--chart-2)'

const bandBarClass = (pct: number): string =>
  pct >= 90
    ? '[&_[data-slot=progress-indicator]]:bg-[var(--chart-1)]'
    : pct >= 70
      ? '[&_[data-slot=progress-indicator]]:bg-primary'
      : '[&_[data-slot=progress-indicator]]:bg-[var(--chart-2)]'

const bandHint = (pct: number): string =>
  pct >= 90 ? 'Presença ≥ 90%' : pct >= 70 ? 'Presença entre 70% e 89%' : 'Presença abaixo de 70%'

const STATUS_COLORS: Record<string, string> = {
  aprovado: 'var(--chart-1)',
  rejeitado: 'var(--destructive)',
  incluida_pauta: 'var(--chart-2)',
  em_tramitacao: 'var(--chart-3)',
  arquivado: 'var(--chart-4)',
  retirado: 'var(--muted-foreground)',
}

const FALLBACK_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

/** Nome curto para o eixo do gráfico (primeiro + último nome quando longo). */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 2 || name.length <= 18) return name
  return `${parts[0]} ${parts[parts.length - 1]}`
}

// ─── Cartões de KPI ─────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string
  value: string
  hint?: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4"
        >
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ─── Configurações de gráfico ───────────────────────────────────────────────

const attendanceChartConfig = {
  pct: { label: 'Presença (%)', color: 'var(--primary)' },
} satisfies ChartConfig

const monthsChartConfig = {
  held: { label: 'Realizadas', color: 'var(--chart-1)' },
  scheduled: { label: 'Agendadas', color: 'var(--chart-2)' },
} satisfies ChartConfig

const cohesionChartConfig = {
  cohesionPct: { label: 'Coesão (%)', color: 'var(--chart-4)' },
} satisfies ChartConfig

// ─── Módulo ─────────────────────────────────────────────────────────────────

const FIRST_YEAR = 2021

export default function AnalyticsModule() {
  const can = useApp((s) => s.can)
  const allowed = can('analytics.read')
  const [year, setYear] = useState(() => new Date().getFullYear())

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: current - FIRST_YEAR + 1 }, (_, i) => current - i)
  }, [])

  const overviewQ = useQuery({
    queryKey: ['analytics', year],
    queryFn: () => fetchOverview(year),
    enabled: allowed,
  })

  const data = overviewQ.data ?? null

  const ranking = useMemo(() => data?.attendanceRanking ?? [], [data])
  const attendanceTop = useMemo(() => ranking.slice(0, 15), [ranking])
  const months = useMemo(() => data?.sessionsByMonth ?? [], [data])
  const discipline = useMemo(() => data?.partyDiscipline ?? [], [data])
  const statusData = useMemo(() => data?.mattersByStatus ?? [], [data])
  const typesData = useMemo(() => data?.mattersByType ?? [], [data])
  const topAuthors = useMemo(() => data?.topAuthors ?? [], [data])
  const proceedings = useMemo(() => data?.proceedingsFlow.items ?? [], [data])

  const statusChartConfig = useMemo(() => {
    const cfg: Record<string, { label: string; color: string }> = {}
    statusData.forEach((s, i) => {
      cfg[s.status] = {
        label: s.statusLabel,
        color: STATUS_COLORS[s.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }
    })
    return cfg satisfies ChartConfig
  }, [statusData])

  const pieData = useMemo(
    () =>
      statusData.map((s, i) => ({
        status: s.status,
        statusLabel: s.statusLabel,
        count: s.count,
        fill: STATUS_COLORS[s.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      })),
    [statusData]
  )

  const attendanceData = useMemo(
    () =>
      attendanceTop.map((r) => ({
        name: shortName(r.name),
        fullName: r.name,
        party: r.party,
        pct: r.pct,
        fill: bandFill(r.pct),
      })),
    [attendanceTop]
  )

  const disciplineData = useMemo(
    () => discipline.map((d) => ({ party: d.party, cohesionPct: d.cohesionPct })),
    [discipline]
  )

  const hasYearData =
    !!data &&
    (data.kpis.totalMatters > 0 ||
      data.votingResults.total > 0 ||
      data.sessionsByMonth.some((m) => m.scheduled > 0))

  const scheduledTotal = data?.sessionsByMonth.reduce((acc, m) => acc + m.scheduled, 0) ?? 0
  const rankingHasSessions = ranking.length > 0 && ranking[0].total > 0

  function handleExportCsv(): void {
    if (ranking.length === 0) return
    exportCsv(
      `presencas-${year}.csv`,
      ranking.map((r) => ({
        Parlamentar: r.name,
        Partido: r.party,
        'Sessões presentes': r.present,
        'Sessões realizadas': r.total,
        'Presença (%)': nf1.format(r.pct),
      }))
    )
    toast.success('CSV exportado', {
      description: `Ranking de presenças de ${year} (${ranking.length} parlamentares).`,
    })
  }

  // ─── Sem permissão (RBAC espelhado; autorização real é server-side) ───────
  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Analytics"
          description="Indicadores de produtividade legislativa"
          icon={<BarChart3 />}
        />
        <EmptyState
          icon={<ShieldAlert />}
          title="Acesso negado"
          description="Seu perfil não tem permissão de leitura dos indicadores (analytics.read)."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        description="Indicadores de produtividade legislativa"
        icon={<BarChart3 />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="analytics-year" className="text-sm text-muted-foreground">
                Ano
              </Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger id="analytics-year" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={ranking.length === 0 || !rankingHasSessions}
            >
              <Download /> Exportar CSV
            </Button>
          </div>
        }
      />

      {overviewQ.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-[440px] rounded-xl lg:col-span-2" />
            <Skeleton className="h-[440px] rounded-xl" />
          </div>
        </div>
      ) : overviewQ.isError ? (
        <EmptyState
          icon={<ShieldAlert />}
          title="Não foi possível carregar os indicadores"
          description="Verifique sua conexão e tente novamente."
          action={
            <Button variant="outline" onClick={() => overviewQ.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : !data ? null : !hasYearData ? (
        <EmptyState
          icon={<BarChart3 />}
          title={`Sem dados em ${year}`}
          description="Nenhuma sessão, matéria ou votação registrada neste ano. Selecione outro ano na barra acima."
        />
      ) : (
        <>
          {/* ─── KPIs ─────────────────────────────────────────────────────── */}
          <section aria-label="Indicadores do ano" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              title="Sessões realizadas"
              value={nfInt.format(data.kpis.sessionsHeld)}
              hint={`${nfInt.format(scheduledTotal)} agendadas no ano`}
              icon={<CalendarCheck />}
            />
            <KpiCard
              title="Presença média"
              value={fmtPct(data.kpis.avgAttendancePct)}
              hint="média por sessão realizada"
              icon={<Users />}
            />
            <KpiCard
              title="Matérias no ano"
              value={nfInt.format(data.kpis.totalMatters)}
              hint={`${nfInt.format(data.kpis.approvedMatters)} aprovadas`}
              icon={<FileText />}
            />
            <KpiCard
              title="Taxa de aprovação"
              value={fmtPct(data.kpis.votingApprovalPct)}
              hint={`${nfInt.format(data.votingResults.total)} votações concluídas`}
              icon={<Gavel />}
            />
            <KpiCard
              title="Tempo médio de tramitação"
              value={fmtDays(data.kpis.avgProceedingDays)}
              hint="do primeiro ao último andamento"
              icon={<Clock />}
            />
          </section>

          {/* ─── Presença por parlamentar + matérias por situação ────────── */}
          <section aria-label="Gráficos de presença e matérias" className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Presença por parlamentar"
              description={`Top ${Math.min(15, attendanceTop.length)} por percentual de presença nas sessões realizadas de ${year}`}
              className="lg:col-span-2"
            >
              {attendanceTop.length === 0 || !rankingHasSessions ? (
                <EmptyState
                  icon={<Users />}
                  title="Sem sessões realizadas"
                  description="Nenhuma sessão encerrada ou em andamento neste ano — sem presenças para exibir."
                />
              ) : (
                <>
                  <p className="sr-only">
                    Gráfico de barras com o percentual de presença dos {attendanceTop.length}{' '}
                    parlamentares mais assíduos. Verde indica presença de 90% ou mais, âmbar abaixo de 70%.
                  </p>
                  <ChartContainer
                    config={attendanceChartConfig}
                    className="h-[440px] w-full aspect-auto"
                    role="img"
                    aria-label="Presença por parlamentar (percentual)"
                  >
                    <BarChart data={attendanceData} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={150}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value) => (
                              <div className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">Presença (%)</span>
                                <span className="font-mono font-medium tabular-nums">
                                  {nf1.format(Number(value))}%
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Bar dataKey="pct" fill="var(--color-pct)" radius={4} barSize={16}>
                        {attendanceData.map((d) => (
                          <Cell key={d.fullName} fill={d.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ backgroundColor: 'var(--chart-1)' }} />
                      ≥ 90%
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ backgroundColor: 'var(--primary)' }} />
                      70–89%
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ backgroundColor: 'var(--chart-2)' }} />
                      &lt; 70%
                    </span>
                  </p>
                </>
              )}
            </ChartCard>

            <ChartCard
              title="Matérias por situação"
              description={`Distribuição das ${nfInt.format(data.kpis.totalMatters)} matérias de ${year}`}
            >
              {pieData.length === 0 ? (
                <EmptyState icon={<FileText />} title="Sem matérias" description="Nenhuma matéria registrada neste ano." />
              ) : (
                <>
                  <p className="sr-only">
                    Gráfico de rosca com a distribuição das matérias por situação:{' '}
                    {pieData.map((s) => `${s.statusLabel}: ${s.count}`).join(', ')}.
                  </p>
                  <ChartContainer
                    config={statusChartConfig}
                    className="h-[300px] w-full aspect-auto"
                    role="img"
                    aria-label="Matérias por situação"
                  >
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        data={pieData}
                        dataKey="count"
                        nameKey="status"
                        innerRadius={58}
                        outerRadius={88}
                        paddingAngle={2}
                        strokeWidth={2}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.status} fill={entry.fill} />
                        ))}
                      </Pie>
                      <ChartLegend content={<ChartLegendContent nameKey="status" />} />
                    </PieChart>
                  </ChartContainer>
                  {typesData.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                      {typesData.map((t) => (
                        <Badge key={t.type} variant="secondary" className="tabular-nums">
                          {t.typeLabel} · {nfInt.format(t.count)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </ChartCard>
          </section>

          {/* ─── Sessões por mês + resultados das votações ────────────────── */}
          <section aria-label="Sessões por mês e votações" className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Sessões por mês"
              description={`Realizadas x agendadas em ${year} (agendadas incluem sessões futuras e canceladas)`}
              className="lg:col-span-2"
            >
              <p className="sr-only">
                Gráfico de barras com sessões realizadas e agendadas por mês de {year}.
              </p>
              <ChartContainer
                config={monthsChartConfig}
                className="h-[300px] w-full aspect-auto"
                role="img"
                aria-label="Sessões por mês"
              >
                <BarChart data={months} margin={{ left: -16, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis allowDecimals={false} width={34} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="held" fill="var(--color-held)" radius={4} />
                  <Bar dataKey="scheduled" fill="var(--color-scheduled)" radius={4} />
                </BarChart>
              </ChartContainer>
            </ChartCard>

            <ChartCard
              title="Resultados das votações"
              description={`${nfInt.format(data.votingResults.total)} votações concluídas em ${year} (nominais, simbólicas e secretas)`}
            >
              <ul className="space-y-2">
                {[
                  { label: 'Aprovadas', value: data.votingResults.approved, variant: 'default' as const },
                  { label: 'Rejeitadas', value: data.votingResults.rejected, variant: 'destructive' as const },
                  { label: 'Empates', value: data.votingResults.draw, variant: 'outline' as const },
                  { label: 'Sem quórum', value: data.votingResults.semQuorum, variant: 'outline' as const },
                  { label: 'Anuladas', value: data.votingResults.annulled, variant: 'outline' as const },
                ].map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <Badge variant={row.variant} className="tabular-nums" aria-label={`${row.label}: ${nfInt.format(row.value)}`}>
                      {nfInt.format(row.value)}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Taxa de aprovação considera apenas votações encerradas (anuladas à parte):{' '}
                <strong className="text-foreground">{fmtPct(data.kpis.votingApprovalPct)}</strong>.
              </p>
            </ChartCard>
          </section>

          {/* ─── Coesão partidária + top autores ──────────────────────────── */}
          <section aria-label="Coesão partidária e autores" className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Coesão por partido"
              description="Alinhamento ao voto majoritário do próprio partido em votações nominais encerradas (votações secretas excluídas — sigilo inviolável)"
              className="lg:col-span-2"
            >
              {disciplineData.length === 0 ? (
                <EmptyState
                  icon={<Gavel />}
                  title="Sem votações nominais encerradas"
                  description="A coesão partidária exige votações nominais concluídas neste ano."
                />
              ) : (
                <>
                  <p className="sr-only">
                    Gráfico de barras com o percentual de coesão de {disciplineData.length} partidos em
                    votações nominais encerradas.
                  </p>
                  <ChartContainer
                    config={cohesionChartConfig}
                    className="h-[320px] w-full aspect-auto"
                    role="img"
                    aria-label="Coesão por partido (percentual)"
                  >
                    <BarChart data={disciplineData} margin={{ left: -8, right: 8, bottom: 4 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="party"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        interval={0}
                        angle={-35}
                        textAnchor="end"
                        height={58}
                      />
                      <YAxis domain={[0, 100]} width={40} tickFormatter={(v) => `${v}%`} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="cohesionPct" fill="var(--color-cohesionPct)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                </>
              )}
            </ChartCard>

            <ChartCard title="Top autores" description={`Autores com mais matérias em ${year}`}>
              {topAuthors.length === 0 ? (
                <EmptyState icon={<Award />} title="Sem autores" description="Nenhuma matéria registrada neste ano." />
              ) : (
                <ol className="space-y-1.5">
                  {topAuthors.map((a, i) => (
                    <li
                      key={a.name}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant={i === 0 ? 'default' : i === 1 ? 'secondary' : 'outline'}
                          className="w-8 justify-center tabular-nums"
                          aria-label={`${i + 1}º lugar`}
                        >
                          {i + 1}º
                        </Badge>
                        <span className="truncate text-sm" title={a.name}>
                          {a.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {nfInt.format(a.count)} {a.count === 1 ? 'matéria' : 'matérias'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </ChartCard>
          </section>

          {/* ─── Ranking completo + tramitação ────────────────────────────── */}
          <section aria-label="Ranking de presenças e tramitação" className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Ranking de presenças"
              description={`Parlamentares ativos por sessões presentes (${nfInt.format(data.kpis.sessionsHeld)} sessão(ões) realizada(s) em ${year})`}
              className="lg:col-span-2"
            >
              {!rankingHasSessions ? (
                <EmptyState
                  icon={<Users />}
                  title="Sem sessões realizadas"
                  description="O ranking aparece quando houver sessões encerradas ou em andamento neste ano."
                />
              ) : (
                <div className="max-h-96 overflow-y-auto custom-scroll rounded-md border">
                  <Table>
                    <TableCaption className="sr-only">
                      Ranking completo de presenças dos parlamentares em {year}
                    </TableCaption>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="w-10 text-right">#</TableHead>
                        <TableHead>Parlamentar</TableHead>
                        <TableHead className="w-20">Partido</TableHead>
                        <TableHead className="w-24 text-right">Presenças</TableHead>
                        <TableHead className="w-20 text-right">%</TableHead>
                        <TableHead className="w-40">Presença</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ranking.map((r, i) => (
                        <TableRow key={r.parliamentarianId}>
                          <TableCell className="text-right text-muted-foreground tabular-nums">{i + 1}</TableCell>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{r.party}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {nfInt.format(r.present)}/{nfInt.format(r.total)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(r.pct)}</TableCell>
                          <TableCell>
                            <Progress
                              value={r.pct}
                              max={100}
                              className={bandBarClass(r.pct)}
                              aria-label={`${r.name}: presença de ${fmtPct(r.pct)} (${bandHint(r.pct)})`}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </ChartCard>

            <ChartCard
              title="Tramitação no ano"
              description={
                data.proceedingsFlow.avgTotalDays !== null
                  ? `Tempo médio do primeiro ao último andamento: ${fmtDays(data.proceedingsFlow.avgTotalDays)}`
                  : 'Tempo médio do primeiro ao último andamento: —'
              }
            >
              {proceedings.length === 0 ? (
                <EmptyState
                  icon={<GitBranch />}
                  title="Sem andamentos"
                  description="Nenhum andamento de tramitação registrado nas matérias deste ano."
                />
              ) : (
                <ul className="space-y-2">
                  {proceedings.map((p) => (
                    <li
                      key={p.action}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{p.actionLabel}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.avgDaysFromPrevious !== null
                            ? `média de ${nf1.format(p.avgDaysFromPrevious)} dias desde o andamento anterior`
                            : 'primeiro andamento das matérias'}
                        </span>
                      </span>
                      <Badge variant="secondary" className="shrink-0 tabular-nums">
                        {nfInt.format(p.count)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </section>

          <p className="text-xs text-muted-foreground">
            Dados agregados de {year} · gerados em{' '}
            {data.generatedAt ? new Date(data.generatedAt).toLocaleString('pt-BR') : '—'} · leitura
            somente para análise — nada é alterado nas fontes.
          </p>
        </>
      )}
    </div>
  )
}
