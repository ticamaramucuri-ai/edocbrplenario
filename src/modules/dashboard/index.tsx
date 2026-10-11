'use client'

/**
 * Módulo Painel — visão inicial do dia operacional: métricas, próximas sessões,
 * pendências e atividade recente (auditoria quando o ator possui permissão).
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Gavel,
  GitBranch,
  Info,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Radio,
  ScrollText,
  Users,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import { SESSION_TYPE_LABEL, type SessionSummary } from '@/lib/contracts'
import { PageHeader, EmptyState } from '@/components/app/page-header'
import { SessionStatusBadge } from '@/components/app/badges'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

const LIVE_STATUSES = ['check_in', 'open', 'suspended', 'resumed']
const UPCOMING_STATUSES = ['draft', 'scheduled', 'check_in']

function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground [&_svg]:size-4">
      {icon}
      {children}
    </h2>
  )
}

function MetricCard({
  title,
  icon,
  children,
  className,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
          {icon}
        </span>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function DashboardModule() {
  const bootstrap = useApp((s) => s.bootstrap)
  const can = useApp((s) => s.can)
  const setModule = useApp((s) => s.setModule)
  const setFocusSession = useApp((s) => s.setFocusSession)

  const tenant = bootstrap?.tenant ?? null
  const canAudit = can('audit.read')

  const sessionsQ = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions() })
  const mattersQ = useQuery({
    queryKey: ['matters', { status: 'em_tramitacao' }],
    queryFn: () => api.listMatters({ status: 'em_tramitacao' }),
  })
  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })
  const tasksQ = useQuery({ queryKey: ['tasks', 'dashboard'], queryFn: () => api.listTasks() })
  const protocolsQ = useQuery({
    queryKey: ['protocols', 'dashboard'],
    queryFn: () => api.listProtocols({ status: 'recebido' }),
  })
  const auditQ = useQuery({
    queryKey: ['audit', { limit: 6 }],
    queryFn: () => api.listAudit({ limit: 6 }),
    enabled: canAudit,
  })

  const sessions = sessionsQ.data?.sessions ?? []

  const liveSession = useMemo(
    () => sessions.find((s) => LIVE_STATUSES.includes(s.status)) ?? bootstrap?.liveSession ?? null,
    [sessions, bootstrap]
  )
  const nextSession = useMemo(() => {
    const upcoming = sessions
      .filter((s) => UPCOMING_STATUSES.includes(s.status))
      .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
    return upcoming[0] ?? bootstrap?.nextSession ?? null
  }, [sessions, bootstrap])

  const upcomingList = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt))
    return sorted.slice(0, 3)
  }, [sessions])

  const activeParliamentarians =
    parlQ.data?.parliamentarians.filter((p) => p.active).length ?? bootstrap?.counts.parliamentarians ?? 0
  const mattersInTramitacao = mattersQ.data?.matters.length ?? 0

  const unpublishedSessions = sessions.filter((s) => !s.agendaPublished && UPCOMING_STATUSES.includes(s.status))
  const auditEvents = auditQ.data?.events ?? []

  const overdueTasks = tasksQ.data?.counts.overdue ?? 0
  const pendingTasks = tasksQ.data?.counts.pendente ?? 0
  const protocolsToDistribute = protocolsQ.data?.counts.recebido ?? 0

  const sessionLabel = (s: SessionSummary) =>
    `${SESSION_TYPE_LABEL[s.type]} nº ${s.number}/${s.year}`

  const conduct = (s: SessionSummary) => {
    setFocusSession(s.id)
    setModule('plenary')
  }

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel"
        description={`${tenant?.name ?? 'Câmara'} · ${today}`}
        icon={<LayoutDashboard />}
      />

      {/* Métricas */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Parlamentares ativos" icon={<Users />}>
          {parlQ.isLoading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums">{activeParliamentarians}</p>
              <p className="text-xs text-muted-foreground">de {bootstrap?.counts.parliamentarians ?? '—'} cadastros</p>
            </>
          )}
        </MetricCard>

        <MetricCard title="Matérias em tramitação" icon={<FileText />}>
          {mattersQ.isLoading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums">{mattersInTramitacao}</p>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setModule('matters')}>
                Ver matérias <ArrowRight className="size-3" />
              </Button>
            </>
          )}
        </MetricCard>

        <MetricCard title="Próxima sessão" icon={<CalendarClock />}>
          {sessionsQ.isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : nextSession ? (
            <div className="space-y-1.5">
              <p className="truncate text-lg font-bold">{sessionLabel(nextSession)}</p>
              <p className="text-xs text-muted-foreground">{fmtDateTime(nextSession.scheduledAt)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <SessionStatusBadge status={nextSession.status} />
                {['scheduled', 'check_in', 'open'].includes(nextSession.status) && (
                  <Button size="sm" className="h-7" onClick={() => conduct(nextSession)}>
                    <Gavel className="size-3.5" /> Conduzir
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma sessão programada</p>
          )}
        </MetricCard>

        <MetricCard title="Sessão ao vivo" icon={<Radio />}>
          {sessionsQ.isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : liveSession ? (
            <div className="space-y-1.5">
              <p className="truncate text-lg font-bold">{sessionLabel(liveSession)}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" aria-hidden />
                {liveSession.presentCount}/{liveSession.totalMembers} presentes
              </p>
              <Button size="sm" className="h-7" onClick={() => conduct(liveSession)}>
                <Gavel className="size-3.5" /> Ir à mesa do plenário
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma sessão em andamento</p>
          )}
        </MetricCard>
      </div>

      {/* Pendências do processo legislativo (Fase 5) */}
      <section aria-label="Pendências do processo legislativo" className="space-y-3">
        <SectionTitle icon={<GitBranch />}>Pendências do processo legislativo</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => setModule('workflow')}
            className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-accent/50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prazos vencidos</p>
              <AlarmClock className={`size-4 ${overdueTasks > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`} aria-hidden />
            </div>
            {tasksQ.isLoading ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <p className={`mt-1 text-3xl font-bold tabular-nums ${overdueTasks > 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                {overdueTasks}
              </p>
            )}
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
              Tarefas pendentes fora do prazo <ArrowRight className="size-3" />
            </p>
          </button>

          <button
            type="button"
            onClick={() => setModule('workflow')}
            className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-accent/50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tarefas pendentes</p>
              <ListTodo className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
            </div>
            {tasksQ.isLoading ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums">{pendingTasks}</p>
            )}
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
              Prazos e distribuições em aberto <ArrowRight className="size-3" />
            </p>
          </button>

          <button
            type="button"
            onClick={() => setModule('workflow')}
            className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-accent/50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Protocolos a distribuir</p>
              <Inbox className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
            </div>
            {protocolsQ.isLoading ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums">{protocolsToDistribute}</p>
            )}
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
              Entradas recebidas aguardando destino <ArrowRight className="size-3" />
            </p>
          </button>

          <button
            type="button"
            onClick={() => setModule('workflow')}
            className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-accent/50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Matérias em tramitação</p>
              <FileText className="size-4 text-primary" aria-hidden />
            </div>
            {mattersQ.isLoading ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums">{mattersInTramitacao}</p>
            )}
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
              Aguardando parecer, pauta ou arquivo <ArrowRight className="size-3" />
            </p>
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Próximas sessões */}
        <section aria-label="Próximas sessões" className="space-y-3">
          <SectionTitle icon={<CalendarClock />}>Próximas sessões</SectionTitle>
          <Card>
            <CardContent className="p-0">
              {sessionsQ.isLoading ? (
                <div className="space-y-3 p-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : upcomingList.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<CalendarClock />}
                    title="Nenhuma sessão cadastrada"
                    description="Cadastre a primeira sessão no módulo Sessões."
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {upcomingList.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{sessionLabel(s)}</p>
                        <p className="text-xs text-muted-foreground">{fmtDateTime(s.scheduledAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                          <Users className="size-3.5" aria-hidden />
                          {s.presentCount}/{s.totalMembers}
                          <span className="sr-only">parlamentares presentes</span>
                        </span>
                        <SessionStatusBadge status={s.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Pendências operacionais */}
        <section aria-label="Pendências operacionais" className="space-y-3">
          <SectionTitle icon={<ListTodo />}>Pendências operacionais</SectionTitle>
          <Card>
            <CardContent className="p-4">
              <ul className="space-y-3">
                {mattersInTramitacao > 0 && (
                  <li className="flex items-start gap-3">
                    <FileText className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <strong className="tabular-nums">{mattersInTramitacao}</strong>{' '}
                        {mattersInTramitacao === 1 ? 'matéria em tramitação' : 'matérias em tramitação'} aguardando
                        inclusão em pauta.
                      </p>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => setModule('matters')}>
                      Ver
                    </Button>
                  </li>
                )}
                {unpublishedSessions.map((s) => (
                  <li key={s.id} className="flex items-start gap-3">
                    <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        {sessionLabel(s)} com <strong>pauta não publicada</strong> ({fmtDateTime(s.scheduledAt)}).
                      </p>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => setModule('sessions')}>
                      Resolver
                    </Button>
                  </li>
                ))}
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  <p className="text-sm">
                    Quórum mínimo regimental:{' '}
                    <strong className="tabular-nums">{tenant?.settings.quorumMinimum ?? '—'} vereadores</strong>
                  </p>
                </li>
                {mattersInTramitacao === 0 && unpublishedSessions.length === 0 && (
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <p className="text-sm">Nenhuma pendência operacional aberta.</p>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Atividade recente */}
      <section aria-label="Atividade recente" className="space-y-3">
        <SectionTitle icon={<ScrollText />}>Atividade recente</SectionTitle>
        {canAudit ? (
          <Card>
            <CardContent className="p-0">
              {auditQ.isLoading ? (
                <div className="space-y-3 p-4">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : auditEvents.length === 0 ? (
                <div className="p-4">
                  <EmptyState icon={<ScrollText />} title="Sem eventos registrados" description="A auditoria ainda não possui eventos." />
                </div>
              ) : (
                <ul className="divide-y">
                  {auditEvents.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <code className="rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground">{e.action}</code>{' '}
                          <span className="font-medium">{e.summary}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{e.actorName}</p>
                      </div>
                      <time className="text-xs text-muted-foreground tabular-nums" dateTime={e.createdAt}>
                        {fmtDateTime(e.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4">
              <EmptyState
                icon={<ScrollText />}
                title="Atividade detalhada indisponível para este perfil"
                description="O panorama do tenant mostra os totais atuais. Perfis com permissão de auditoria visualizam os últimos eventos com ator e horário."
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{bootstrap?.counts.parliamentarians ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Parlamentares ativos</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{bootstrap?.counts.matters ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Matérias cadastradas</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{bootstrap?.counts.sessions ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Sessões registradas</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}
