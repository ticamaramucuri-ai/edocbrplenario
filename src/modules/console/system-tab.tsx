'use client'

/**
 * Fase 16 — Aba "Sistema" do Console da Plataforma: observabilidade operacional
 * do SaaS (ADR-017). Verificação automática a cada 30s + botão "Verificar
 * novamente": health dos mini-serviços com latência (timeout curto server-side
 * — serviço parado aparece como "Parado", nunca como erro da rota), tamanho do
 * banco/WAL, filas (outbox pendente + idade do mais antigo; webhooks
 * pendentes/mortos), atividade (tenants, sessões de hoje, último evento
 * auditado), runtime (uptime, heap) e banners de alerta com ação sugerida.
 * Acesso exclusivo de platform_owner (RBAC server-side na rota).
 *
 * Fase 20 — "Alertas persistentes": os alertas derivados agora são PERSISTIDOS
 * em PlatformAlert (dedupe por kind aberto, reconhecimento auditado em
 * /platform/alerts/:id/ack — exclusivo do owner) e aparecem numa seção própria
 * com estado (Aberto/Reconhecido + quem/quando). Os derivados em memória
 * continuam como reforço na seção "Verificações em tempo real".
 *
 * Onda 5 / Fase 21 — seção "Agendamentos": tabela dos ScheduledJob mantidos
 * pelo mini-serviço scheduler :3005 (tick de 30s) com "Rodar agora"
 * (AlertDialog + POST /platform/schedules/:id/run — nunca adianta nextRunAt) e
 * pausar/retomar (PATCH). Ações exclusivas de platform.manage
 * (platform_support vê somente leitura — nota explícita).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  Database,
  History,
  Info,
  MemoryStick,
  Pause,
  Play,
  RefreshCw,
  Server,
  Timer,
  Webhook as WebhookIcon,
  XCircle,
} from 'lucide-react'

import type { PlatformAlertView, ScheduledJobView, SystemStatusView } from '@/lib/contracts'
import { SCHEDULED_JOB_KIND_LABEL } from '@/lib/contracts'
import { schedulesApi } from '@/lib/api-client'
import { fmtDateTime } from '@/lib/format'
import { useApp } from '@/lib/store'
import { EmptyState } from '@/components/app/page-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// Coexistência com o modo demo (ADR-005): sem sessão, o header resolve o ator.
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const problem = (body ?? {}) as { detail?: string }
    throw new Error(problem.detail ?? 'Falha ao verificar o status do sistema.')
  }
  return body as T
}

// ─── Formatação pt-BR ───────────────────────────────────────────────────────

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  const m = Math.floor((seconds % 3_600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

type Alert = SystemStatusView['alerts'][number]

/** system-status da Fase 20 também devolve os alertas persistidos (compat). */
type SystemStatusWithAlerts = SystemStatusView & { platformAlerts: PlatformAlertView[] }

const SEVERITY_META: Record<
  Alert['severity'],
  { label: string; banner: string; iconColor: string; badge: string }
> = {
  critical: {
    label: 'Crítico',
    banner: 'border-rose-500/60 bg-rose-500/10',
    iconColor: 'text-rose-600 dark:text-rose-400',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
  warn: {
    label: 'Atenção',
    banner: 'border-amber-500/60 bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  info: {
    label: 'Informativo',
    banner: 'border-primary/40 bg-primary/10',
    iconColor: 'text-primary',
    badge: 'bg-primary/15 text-primary',
  },
}

const PERSISTENT_SEVERITY_META: Record<
  PlatformAlertView['severity'],
  { label: string; banner: string; iconColor: string; badge: string }
> = {
  critical: SEVERITY_META.critical,
  warning: SEVERITY_META.warn,
  info: SEVERITY_META.info,
}

/** Linha rótulo→valor usada nos cards de infraestrutura. */
function Metric({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </span>
      <span
        className={`shrink-0 text-sm font-medium tabular-nums ${
          highlight ? 'text-rose-600 dark:text-rose-400' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function CardShell({
  title,
  icon,
  children,
  action,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-2 divide-y">{children}</div>
    </div>
  )
}

// ─── Alertas persistentes (Fase 20) ─────────────────────────────────────────

function PersistentAlertsSection({
  alerts,
  isLoading,
  onAck,
  ackPending,
}: {
  alerts: PlatformAlertView[]
  isLoading: boolean
  onAck: (id: string) => void
  ackPending: boolean
}) {
  const open = alerts.filter((a) => !a.ackAt)
  const acked = alerts.filter((a) => a.ackAt)
  return (
    <section aria-label="Alertas persistentes" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BellRing className="size-4 text-muted-foreground" aria-hidden /> Alertas persistentes
        </h2>
        <p className="text-xs text-muted-foreground">
          {open.length} aberto(s) · {acked.length} reconhecido(s) · deduplicados por tipo
        </p>
      </div>
      <div className="max-h-96 overflow-y-auto custom-scroll p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-medium">
            <CheckCircle2
              className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            Nenhum alerta persistente — a operação está saudável.
          </p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert) => {
              const meta = PERSISTENT_SEVERITY_META[alert.severity] ?? PERSISTENT_SEVERITY_META.warning
              return (
                <li
                  key={alert.id}
                  className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${meta.banner} ${
                    alert.ackAt ? 'opacity-70' : ''
                  }`}
                >
                  {alert.severity === 'info' ? (
                    <Info className={`mt-0.5 size-4 shrink-0 ${meta.iconColor}`} aria-hidden="true" />
                  ) : (
                    <AlertTriangle
                      className={`mt-0.5 size-4 shrink-0 ${meta.iconColor}`}
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{alert.message}</p>
                    {alert.actionHint && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="sr-only">Ação sugerida: </span>
                        {alert.actionHint}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {alert.kind} · criado em {fmtDateTime(alert.createdAt)}
                      {alert.ackAt && alert.ackBy
                        ? ` · reconhecido por ${alert.ackBy} em ${fmtDateTime(alert.ackAt)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {alert.ackAt ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="size-3" /> Reconhecido
                      </Badge>
                    ) : (
                      <>
                        <Badge className={meta.badge}>Aberto · {meta.label}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onAck(alert.id)}
                          disabled={ackPending}
                          aria-label={`Reconhecer alerta: ${alert.message}`}
                        >
                          Reconhecer
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

// ─── Fase 21: Agendamentos (scheduler :3005) ────────────────────────────────

/** Intervalo legível: 300→"5 min", 600→"10 min", 3600→"1 h", 86400→"24 h". */
function fmtInterval(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} h`
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`
  return `${seconds} s`
}

/** Próxima execução: relativo pt-BR + hora fixa ("em 4 minutos · 14:32"). */
function fmtNextRun(iso: string): { text: string; overdue: boolean } {
  const date = new Date(iso)
  const relative = formatDistanceToNowStrict(date, { addSuffix: true, locale: ptBR })
  const time = format(date, 'HH:mm', { locale: ptBR })
  return { text: `${relative} · ${time}`, overdue: date.getTime() < Date.now() }
}

const LAST_STATUS_META: Record<string, { label: string; badge: string }> = {
  ok: { label: 'ok', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  error: { label: 'erro', badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  skipped: { label: 'pulado', badge: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300' },
}

function LastStatusBadge({ status }: { status: string | null }) {
  const meta = status ? LAST_STATUS_META[status] : undefined
  if (!meta) return <Badge variant="outline">—</Badge>
  return <Badge className={meta.badge}>{meta.label}</Badge>
}

function SchedulesSection({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const [confirmJob, setConfirmJob] = useState<ScheduledJobView | null>(null)

  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => schedulesApi.list(),
    refetchInterval: 30_000,
  })

  const runNow = useMutation({
    mutationFn: (id: string) => schedulesApi.run(id),
    onSuccess: (res) => {
      const job = res.job
      const statusMeta = LAST_STATUS_META[job.lastStatus ?? ''] ?? { label: job.lastStatus ?? '—' }
      toast.success(`"${job.title}" executado`, {
        description: `Status: ${statusMeta.label} · ${job.lastNote ?? 'sem nota'} · a agenda não foi adiantada.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (err) => {
      toast.error('Falha ao executar o agendamento', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  const toggleActive = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      schedulesApi.update(input.id, { active: input.active }),
    onSuccess: (res) => {
      toast.success(res.job.active ? `"${res.job.title}" retomado` : `"${res.job.title}" pausado`, {
        description: res.job.active
          ? 'O job volta a rodar no próximo tick agendado (30s).'
          : 'O tick de 30s passa a ignorar este job até ser retomado.',
      })
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (err) => {
      toast.error('Falha ao atualizar o agendamento', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  const jobs = schedules.data?.jobs ?? []

  const actionsFor = (job: ScheduledJobView) =>
    canManage ? (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmJob(job)}
          disabled={runNow.isPending}
          aria-label={`Rodar agora: ${job.title}`}
        >
          <Play className="size-3.5" /> Rodar agora
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => toggleActive.mutate({ id: job.id, active: !job.active })}
          disabled={toggleActive.isPending}
          aria-label={job.active ? `Pausar: ${job.title}` : `Retomar: ${job.title}`}
        >
          <Pause className="size-3.5" /> {job.active ? 'Pausar' : 'Retomar'}
        </Button>
      </div>
    ) : null

  return (
    <section aria-label="Agendamentos" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Timer className="size-4 text-muted-foreground" aria-hidden /> Agendamentos
        </h2>
        <p className="text-xs text-muted-foreground">
          scheduler :3005 · tick de 30s · {jobs.length} job(s){' '}
          {canManage ? '' : '· somente leitura (suporte)'}
        </p>
      </div>

      <div className="max-h-96 overflow-y-auto custom-scroll">
        {schedules.isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : schedules.isError ? (
          <div className="p-4">
            <EmptyState
              icon={<AlertTriangle className="size-8" />}
              title="Não foi possível carregar os agendamentos"
              description={
                schedules.error instanceof Error
                  ? schedules.error.message
                  : 'Erro inesperado ao consultar /platform/schedules.'
              }
              action={
                <Button variant="outline" size="sm" onClick={() => schedules.refetch()}>
                  <RefreshCw /> Tentar novamente
                </Button>
              }
            />
          </div>
        ) : jobs.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum agendamento cadastrado (esperado: 4 jobs no seed da base).
          </p>
        ) : (
          <>
            {/* Tabela (md+) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Agendamentos da plataforma (scheduler :3005)</caption>
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-medium">Job</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Intervalo</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Próxima execução</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Última execução</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Ativo</th>
                    {canManage && (
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Ações</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const next = fmtNextRun(job.nextRunAt)
                    return (
                      <tr key={job.id} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <p className="font-medium">{job.title}</p>
                          <p className="font-mono text-[11px] text-muted-foreground" title={SCHEDULED_JOB_KIND_LABEL[job.kind]}>
                            {job.kind}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                          {fmtInterval(job.everySeconds)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          <span
                            className={`inline-flex items-center gap-1.5 tabular-nums ${
                              next.overdue ? 'font-medium text-amber-600 dark:text-amber-400' : ''
                            }`}
                          >
                            <CalendarClock className="size-3.5" aria-hidden />
                            {next.overdue ? `atrasado (${next.text})` : next.text}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex items-center gap-2 text-xs tabular-nums">
                              <span>{fmtDateTime(job.lastRunAt)}</span>
                              <LastStatusBadge status={job.lastStatus} />
                            </div>
                            {job.lastNote && (
                              <p
                                className="line-clamp-1 max-w-72 text-[11px] text-muted-foreground"
                                title={job.lastNote}
                              >
                                {job.lastNote}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {job.active ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                              Ativo
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Pausado</Badge>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3 text-right">{actionsFor(job)}</td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards empilhados (mobile) */}
            <ul className="space-y-2 p-4 md:hidden">
              {jobs.map((job) => {
                const next = fmtNextRun(job.nextRunAt)
                return (
                  <li key={job.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{job.title}</p>
                        <p className="font-mono text-[11px] text-muted-foreground" title={SCHEDULED_JOB_KIND_LABEL[job.kind]}>
                          {job.kind}
                        </p>
                      </div>
                      {job.active ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Pausado</Badge>
                      )}
                    </div>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Intervalo</dt>
                        <dd className="tabular-nums">{fmtInterval(job.everySeconds)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Próxima</dt>
                        <dd
                          className={`text-right tabular-nums ${
                            next.overdue ? 'font-medium text-amber-600 dark:text-amber-400' : ''
                          }`}
                        >
                          {next.overdue ? `atrasado (${next.text})` : next.text}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Última</dt>
                        <dd className="flex items-center gap-1.5 tabular-nums">
                          {fmtDateTime(job.lastRunAt)}
                          <LastStatusBadge status={job.lastStatus} />
                        </dd>
                      </div>
                    </dl>
                    {job.lastNote && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground" title={job.lastNote}>
                        {job.lastNote}
                      </p>
                    )}
                    {canManage && <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">{actionsFor(job)}</div>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      {!canManage && jobs.length > 0 && (
        <p className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          Somente leitura — rodar agora, pausar e retomar são exclusivos do Operador da Plataforma
          (platform_owner).
        </p>
      )}

      {/* Confirmação forte: executa o job IMEDIATAMENTE (sem adiantar a agenda) */}
      <AlertDialog open={!!confirmJob} onOpenChange={(open) => !open && setConfirmJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Play className="size-5 text-primary" aria-hidden />
              Rodar “{confirmJob?.title}” agora?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O job <span className="font-mono text-xs">{confirmJob?.kind}</span> será executado
              imediatamente pelo scheduler (porta 3005) e o resultado ficará registrado na linha do
              agendamento. A agenda <strong>não é adiantada</strong>: a próxima execução automática
              continua no horário previsto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmJob) runNow.mutate(confirmJob.id)
                setConfirmJob(null)
              }}
            >
              Executar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ─── Componente principal ───────────────────────────────────────────────────

export default function SystemTab() {
  const isOwner = useApp((s) => s.actor?.role === 'platform_owner')
  const can = useApp((s) => s.can)
  const canManage = can('platform.manage')
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => apiFetch<SystemStatusWithAlerts>('/api/v1/platform/system-status'),
    refetchInterval: 30_000,
  })

  // Fase 20 — reconhecimento de alerta persistente (exclusivo do owner; a rota
  // valida RBAC platform.manage de qualquer forma).
  const ackAlert = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ alert: PlatformAlertView }>(`/api/v1/platform/alerts/${id}/ack`, {
        method: 'POST',
      }),
    onSuccess: (res) => {
      toast.success('Alerta reconhecido', {
        description: `${res.alert.kind} — registrado por ${res.alert.ackBy}.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['system-status'] })
      void queryClient.invalidateQueries({ queryKey: ['platform-alerts'] })
    },
    onError: (err) => {
      toast.error('Falha ao reconhecer o alerta', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  if (status.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title="Não foi possível verificar o sistema"
        description={
          status.error instanceof Error
            ? status.error.message
            : 'Erro inesperado ao consultar o status da plataforma.'
        }
        action={
          <Button variant="outline" size="sm" onClick={() => status.refetch()}>
            <RefreshCw /> Tentar novamente
          </Button>
        }
      />
    )
  }

  const data = status.data
  const queues = data?.queues
  const activity = data?.activity
  const runtime = data?.runtime

  return (
    <div className="space-y-6">
      {/* Barra de verificação: horário da última checagem + botão manual */}
      <section
        aria-label="Controles de verificação"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold">Saúde da plataforma</p>
          <p className="text-xs text-muted-foreground">
            Verificação automática a cada 30 segundos ·{' '}
            {data ? `última em ${fmtDateTime(data.checkedAt)}` : 'carregando…'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => status.refetch()}
          disabled={status.isFetching}
        >
          <RefreshCw className={status.isFetching ? 'animate-spin' : undefined} />
          Verificar novamente
        </Button>
      </section>

      {/* Alertas persistentes (Fase 20): reconhecimento auditado pelo owner */}
      <PersistentAlertsSection
        alerts={data?.platformAlerts ?? []}
        isLoading={!data && status.isLoading}
        onAck={(id) => ackAlert.mutate(id)}
        ackPending={ackAlert.isPending || !isOwner}
      />

      {/* Agendamentos (Fase 21): jobs do scheduler :3005 com rodar agora / pausar */}
      <SchedulesSection canManage={canManage} />

      {/* Verificações em tempo real — derivadas a cada leitura (reforço) */}
      <section aria-label="Verificações em tempo real" className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-muted-foreground" aria-hidden /> Verificações em tempo real
          <span className="font-normal text-xs text-muted-foreground">
            recalculadas a cada leitura — sem persistência
          </span>
        </h2>
        {!data ? null : data.alerts.length > 0 ? (
          <div className="space-y-3">
          {data.alerts.map((alert) => {
            const meta = SEVERITY_META[alert.severity]
            return (
              <div
                key={alert.id}
                role="alert"
                className={`flex items-start gap-3 rounded-lg border p-3 ${meta.banner}`}
              >
                {alert.severity === 'info' ? (
                  <Info className={`mt-0.5 size-4 shrink-0 ${meta.iconColor}`} aria-hidden="true" />
                ) : (
                  <AlertTriangle
                    className={`mt-0.5 size-4 shrink-0 ${meta.iconColor}`}
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{alert.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="sr-only">Ação sugerida: </span>
                    {alert.action}
                  </p>
                </div>
                <Badge className={`shrink-0 ${meta.badge}`}>{meta.label}</Badge>
              </div>
            )
          })}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
            <CheckCircle2
              className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              Nenhum alerta em tempo real — tudo operacional
              <span className="block text-xs font-normal text-muted-foreground">
                Serviços no ar, filas sem backlog e nenhuma assinatura inadimplente.
              </span>
            </p>
          </div>
        )}
      </section>

      {/* Cards: serviços + banco + filas + atividade + runtime */}
      <section
        aria-label="Detalhes do sistema"
        className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      >
        {!data
          ? // Skeletons (mesma quantidade de cards esperados)
            [...Array(6)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
          : (
            <>
              {data.services.map((svc) => (
                <div key={svc.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <span className="text-muted-foreground [&_svg]:size-4">
                        <Server />
                      </span>
                      {svc.name}
                    </h3>
                    {svc.ok ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="size-3" /> Operacional
                      </Badge>
                    ) : (
                      <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">
                        <XCircle className="size-3" /> Parado
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={svc.url}>
                    {svc.url}
                  </p>
                  <div className="mt-3 divide-y">
                    <Metric
                      icon={<Activity className="size-3" />}
                      label="Latência"
                      value={svc.latencyMs !== null ? `${svc.latencyMs} ms` : '—'}
                    />
                    {!svc.ok && svc.detail && (
                      <Metric
                        icon={<AlertTriangle className="size-3" />}
                        label="Detalhe"
                        value={<span className="text-xs">{svc.detail}</span>}
                        highlight
                      />
                    )}
                  </div>
                </div>
              ))}

              <CardShell title="Banco de dados" icon={<Database />}>
                <Metric
                  icon={<Database className="size-3" />}
                  label="Arquivo (custom.db)"
                  value={fmtBytes(data.database.fileBytes)}
                />
                <Metric
                  icon={<Database className="size-3" />}
                  label="WAL (custom.db-wal)"
                  value={fmtBytes(data.database.walBytes)}
                />
                <p className="pt-2 text-[11px] text-muted-foreground">
                  SQLite em modo WAL — caminho relativo ao processo Next.js.
                </p>
              </CardShell>

              <CardShell title="Filas" icon={<WebhookIcon />}>
                <Metric
                  icon={<Activity className="size-3" />}
                  label="Outbox pendente"
                  value={queues?.outboxPending ?? '—'}
                />
                <Metric
                  icon={<History className="size-3" />}
                  label="Mais antigo no outbox"
                  value={
                    queues?.outboxOldestPendingMinutes !== null &&
                    queues?.outboxOldestPendingMinutes !== undefined
                      ? `há ${queues.outboxOldestPendingMinutes} min`
                      : '—'
                  }
                />
                <Metric
                  icon={<WebhookIcon className="size-3" />}
                  label="Webhooks pendentes"
                  value={queues?.webhookPending ?? '—'}
                />
                <Metric
                  icon={<AlertTriangle className="size-3" />}
                  label="Webhooks em dead-letter"
                  value={queues?.webhookDead ?? '—'}
                  highlight={(queues?.webhookDead ?? 0) > 0}
                />
              </CardShell>

              <CardShell title="Atividade" icon={<CalendarDays />}>
                <Metric
                  icon={<CalendarDays className="size-3" />}
                  label="Câmaras ativas"
                  value={
                    activity ? `${activity.tenantsActive}/${activity.tenantsTotal}` : '—'
                  }
                />
                <Metric
                  icon={<CalendarDays className="size-3" />}
                  label="Sessões hoje (todas as câmaras)"
                  value={activity?.sessionsToday ?? '—'}
                />
                <Metric
                  icon={<History className="size-3" />}
                  label="Último evento auditado"
                  value={
                    activity?.lastAuditAt ? (
                      <span className="text-xs">{fmtDateTime(activity.lastAuditAt)}</span>
                    ) : (
                      '—'
                    )
                  }
                />
              </CardShell>

              <CardShell title="Runtime (processo Next.js)" icon={<MemoryStick />}>
                <Metric
                  icon={<Activity className="size-3" />}
                  label="Uptime"
                  value={runtime ? fmtUptime(runtime.uptimeSeconds) : '—'}
                />
                <Metric
                  icon={<MemoryStick className="size-3" />}
                  label="Heap usado / total"
                  value={
                    runtime ? `${runtime.heapUsedMb} / ${runtime.heapTotalMb} MB` : '—'
                  }
                />
                <p className="pt-2 text-[11px] text-muted-foreground">
                  Serviço parado? Reinicie seguindo o runbook (docs/runbook.md).
                </p>
              </CardShell>
            </>
          )}
      </section>
    </div>
  )
}
