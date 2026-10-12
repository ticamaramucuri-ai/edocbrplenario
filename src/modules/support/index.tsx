'use client'

/**
 * Módulo: Suporte da Plataforma (Onda 4 / Fase 20 / ADR-021).
 *
 * Ferramentas de operação e suporte do SaaS:
 *  - Saúde resumida (payload do system-status: serviços 3003/3004, banco, filas, uptime);
 *  - Alertas operacionais PERSISTENTES (PlatformAlert) com reconhecimento
 *    exclusivo do platform_owner (RBAC server-side em /platform/alerts/:id/ack);
 *  - "Operar como usuário" — impersonação auditada (motivo ≥ 10 caracteres, prazo
 *    15–60 min, banner âmbar permanente no topbar, auditoria dedicada e expiração
 *    lazy). Exige login por SENHA (sessão httpOnly) — o modo demo x-actor-id não
 *    permite impersonar (409 na rota).
 *  - Histórico de impersonações (ativas primeiro).
 *
 * Onda 5 / Fase 21 — card "Watchdog de exportações": jobs de exportação em
 * failed/running com tempo decorrido, ação "Reprocessar" para os com falha
 * (POST /platform/exports/:id/requeue — reset + reprocessamento em background
 * + ack do alerta export.orphan) e o estado do job export.watchdog do
 * scheduler :3005 (última execução/nota) via schedulesApi.
 *
 * Visível na sidebar para todos os perfis (padrão do projeto), mas o conteúdo
 * exige `platform.read` (platform_owner e platform_support); demais papéis veem
 * estado vazio "Acesso restrito ao suporte da plataforma".
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  Database,
  FileJson,
  Headset,
  History,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Timer,
  UserRoundCog,
  XCircle,
} from 'lucide-react'

import type {
  ActorView,
  PlatformAlertView,
  ScheduledJobView,
  SupportImpersonationView,
  SystemStatusView,
} from '@/lib/contracts'
import { ROLE_LABEL } from '@/lib/contracts'
import { schedulesApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import { useMe, type MeView } from '@/hooks/use-auth-me'
import { EmptyState, PageHeader } from '@/components/app/page-header'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** system-status da Fase 20 também devolve os alertas persistidos (compat). */
type SystemStatusWithAlerts = SystemStatusView & { platformAlerts: PlatformAlertView[] }

type ImpersonationTarget = {
  id: string
  name: string
  email: string
  role: keyof typeof ROLE_LABEL
  jobTitle: string | null
}

type ImpersonationsPayload = {
  history: SupportImpersonationView[]
  active: SupportImpersonationView | null
  targets: ImpersonationTarget[]
}

type AlertsPayload = { alerts: PlatformAlertView[] }

// Coexistência com o modo demo (ADR-005): sessão por cookie tem prioridade; sem
// sessão o header x-actor-id resolve o ator (fetch próprio, fora do api-client).
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  if (init?.body) headers.set('content-type', 'application/json')
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const problem = (body ?? {}) as { detail?: string }
    throw new Error(problem.detail ?? `Falha na requisição (${res.status}).`)
  }
  return body as T
}

/** Monta o ActorView do /auth/me para trocar o ator da store (banner incluso). */
function actorFromMe(me: MeView['actor']): ActorView {
  return {
    id: me.id,
    name: me.name,
    role: me.role,
    jobTitle: me.jobTitle ?? null,
    parliamentarianId: me.parliamentarianId ?? null,
    impersonation: me.impersonation ?? null,
  }
}

async function fetchMeActor(): Promise<MeView['actor'] | null> {
  try {
    const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    return ((await res.json()) as MeView).actor
  } catch {
    return null
  }
}

// ─── Formatação ─────────────────────────────────────────────────────────────

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

const SEVERITY_META: Record<
  PlatformAlertView['severity'],
  { label: string; banner: string; badge: string; icon: string }
> = {
  critical: {
    label: 'Crítico',
    banner: 'border-rose-500/60 bg-rose-500/10',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    icon: 'text-rose-600 dark:text-rose-400',
  },
  warning: {
    label: 'Atenção',
    banner: 'border-amber-500/60 bg-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    label: 'Informativo',
    banner: 'border-primary/40 bg-primary/10',
    badge: 'bg-primary/15 text-primary',
    icon: 'text-primary',
  },
}

const MINUTES_OPTIONS = [15, 30, 45, 60]

// ─── Seção: saúde resumida ──────────────────────────────────────────────────

function HealthSummary({ status }: { status: SystemStatusWithAlerts | undefined }) {
  const services = status?.services ?? []
  const queues = status?.queues
  return (
    <section aria-label="Saúde resumida da plataforma" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {services.length === 0
        ? [...Array(2)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        : services.map((svc) => (
            <div key={svc.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Server className="size-4 text-muted-foreground" aria-hidden />
                  {svc.name}
                </h3>
                {svc.ok ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-3" /> No ar
                  </Badge>
                ) : (
                  <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">
                    <XCircle className="size-3" /> Parado
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                {svc.ok ? `Latência ${svc.latencyMs} ms` : (svc.detail ?? 'Sem resposta')}
              </p>
            </div>
          ))}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4 text-muted-foreground" aria-hidden /> Banco e filas
        </h3>
        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          SQLite {fmtBytes(status?.database.fileBytes)} · WAL {fmtBytes(status?.database.walBytes)}
        </p>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          Outbox pendente: {queues?.outboxPending ?? '—'} · Webhooks mortos:{' '}
          <span className={(queues?.webhookDead ?? 0) > 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : undefined}>
            {queues?.webhookDead ?? '—'}
          </span>
        </p>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          E-mails pendentes: {queues?.mailPending ?? '—'} · Esgotados: {queues?.mailDead ?? '—'}
        </p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-muted-foreground" aria-hidden /> Runtime
        </h3>
        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          Uptime {status ? fmtUptime(status.runtime.uptimeSeconds) : '—'}
        </p>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          Heap {status ? `${status.runtime.heapUsedMb} / ${status.runtime.heapTotalMb} MB` : '—'}
        </p>
      </div>
    </section>
  )
}

// ─── Seção: alertas ativos ──────────────────────────────────────────────────

function AlertsSection({
  alerts,
  isLoading,
  canAck,
  onAck,
  ackPending,
}: {
  alerts: PlatformAlertView[]
  isLoading: boolean
  canAck: boolean
  onAck: (id: string) => void
  ackPending: boolean
}) {
  const open = alerts.filter((a) => !a.ackAt)
  return (
    <section aria-label="Alertas ativos" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BellRing className="size-4 text-muted-foreground" aria-hidden /> Alertas ativos
        </h2>
        <p className="text-xs text-muted-foreground">
          {isLoading ? 'carregando…' : `${open.length} aberto(s) · persistidos com reconhecimento`}
        </p>
      </div>
      <div className="max-h-96 overflow-y-auto custom-scroll p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : open.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-medium">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Nenhum alerta aberto — a operação está saudável.
            <span className="block text-xs font-normal text-muted-foreground">
              Verificações automáticas a cada 30s criam alertas persistentes deduplicados.
            </span>
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((alert) => {
              const meta = SEVERITY_META[alert.severity] ?? SEVERITY_META.warning
              return (
                <li
                  key={alert.id}
                  role="alert"
                  className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${meta.banner}`}
                >
                  {alert.severity === 'info' ? (
                    <Info className={`mt-0.5 size-4 shrink-0 ${meta.icon}`} aria-hidden="true" />
                  ) : (
                    <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${meta.icon}`} aria-hidden="true" />
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
                      {alert.kind} · desde {fmtDateTime(alert.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={meta.badge}>{meta.label}</Badge>
                    {canAck ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onAck(alert.id)}
                        disabled={ackPending}
                        aria-label={`Reconhecer alerta: ${alert.message}`}
                      >
                        Reconhecer
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground" title="Reconhecimento exclusivo do operador da plataforma (platform_owner)">
                        Reconhecimento: owner
                      </span>
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

// ─── Seção: watchdog de exportações (Fase 21) ───────────────────────────────

/** Job de exportação com tenant (shape do GET /platform/exports). */
type WatchdogJob = {
  id: string
  status: 'failed' | 'running'
  progress: number
  error: string | null
  createdAt: string
  finishedAt: string | null
  tenant: { name: string; slug: string }
}

/** Função LOCAL tipada (api-client não é editável nesta task): requeue do job. */
async function requeueExport(jobId: string): Promise<{ job: WatchdogJob | null }> {
  return apiFetch<{ job: WatchdogJob | null }>(`/api/v1/platform/exports/${jobId}/requeue`, {
    method: 'POST',
  })
}

/** Tempo decorrido pt-BR compacto ("há 12 min", "há 3h 20min", "há 2d"). */
function fmtElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `há ${h}h ${min % 60}min` : `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function WatchdogSection({ watchdogJob }: { watchdogJob: ScheduledJobView | undefined }) {
  const queryClient = useQueryClient()

  const exportsQuery = useQuery({
    queryKey: ['export-watchdog'],
    queryFn: () => apiFetch<{ jobs: WatchdogJob[] }>('/api/v1/platform/exports'),
    refetchInterval: 15_000,
  })

  const requeue = useMutation({
    mutationFn: (jobId: string) => requeueExport(jobId),
    onSuccess: (res) => {
      toast.success('Job reprocessado', {
        description: res.job
          ? `Exportação ${res.job.id.slice(-6)} reenfileirada — reprocessando em background (o download volta a ficar disponível ao concluir).`
          : 'Job reenfileirado para reprocessamento em background.',
      })
      void queryClient.invalidateQueries({ queryKey: ['export-watchdog'] })
      void queryClient.invalidateQueries({ queryKey: ['platform-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['system-status'] })
    },
    onError: (err) => {
      toast.error('Falha ao reprocessar', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  const jobs = exportsQuery.data?.jobs ?? []
  const running = jobs.filter((j) => j.status === 'running')
  const failed = jobs.filter((j) => j.status === 'failed')

  return (
    <section aria-label="Watchdog de exportações" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Timer className="size-4 text-muted-foreground" aria-hidden /> Watchdog de exportações
        </h2>
        <p className="text-xs text-muted-foreground">
          jobs em failed/running · running &gt; 10 min vira failed + alerta export.orphan
        </p>
      </div>

      {/* Estado do agendamento export.watchdog (scheduler :3005) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
        {watchdogJob ? (
          <>
            <p className="min-w-0 text-xs text-muted-foreground">
              <span className="font-mono">export.watchdog</span> · última execução{' '}
              <span className="tabular-nums text-foreground">{fmtDateTime(watchdogJob.lastRunAt)}</span>
              {watchdogJob.lastNote && (
                <>
                  {' '}
                  — <span>{watchdogJob.lastNote}</span>
                </>
              )}
            </p>
            <Badge
              variant="outline"
              className={
                watchdogJob.lastStatus === 'ok'
                  ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : watchdogJob.lastStatus === 'error'
                    ? 'border-rose-500/40 text-rose-700 dark:text-rose-300'
                    : 'text-muted-foreground'
              }
            >
              {watchdogJob.lastStatus ?? '—'}
            </Badge>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">export.watchdog</span> · carregando estado do scheduler…
          </p>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto custom-scroll p-4">
        {exportsQuery.isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-medium">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Nenhuma exportação com falha ou em andamento.
            <span className="block text-xs font-normal text-muted-foreground">
              O watchdog do scheduler (porta 3005) monitora jobs presos a cada 10 min.
            </span>
          </p>
        ) : (
          <ul className="space-y-2">
            {[...failed, ...running].map((job) => (
              <li
                key={job.id}
                className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${
                  job.status === 'failed'
                    ? 'border-rose-500/50 bg-rose-500/5'
                    : 'border-amber-500/50 bg-amber-500/5'
                }`}
              >
                {job.status === 'failed' ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                ) : (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    <FileJson className="mr-1 inline size-3.5 text-muted-foreground" aria-hidden />
                    Exportação {job.id.slice(-6)} · {job.tenant.name}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {job.status === 'failed' ? (
                      <>
                        falhou {job.finishedAt ? fmtElapsed(job.finishedAt) : fmtElapsed(job.createdAt)} ·
                        criada {fmtElapsed(job.createdAt)}
                      </>
                    ) : (
                      <>
                        em andamento há {fmtElapsed(job.createdAt)} · {job.progress}% (watchdog marca
                        failed após 10 min)
                      </>
                    )}
                  </p>
                  {job.error && (
                    <p
                      className="mt-1 line-clamp-2 max-w-xl text-[11px] text-muted-foreground"
                      title={job.error}
                    >
                      {job.error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    className={
                      job.status === 'failed'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    }
                  >
                    {job.status === 'failed' ? 'Falhou' : 'Running'}
                  </Badge>
                  {job.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => requeue.mutate(job.id)}
                      disabled={requeue.isPending}
                      aria-label={`Reprocessar exportação ${job.id.slice(-6)} de ${job.tenant.name}`}
                    >
                      <RotateCcw className="size-3.5" /> Reprocessar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ─── Seção: operar como usuário (impersonação) ──────────────────────────────

/** Entrada do formulário de impersonação (estado interno da seção). */
type ImpersonationInput = { target: ImpersonationTarget; reason: string; minutes: number }

function ImpersonationSection({
  data,
  isLoading,
  hasSession,
  starting,
  onStart,
  onEnd,
  endPending,
}: {
  data: ImpersonationsPayload | undefined
  isLoading: boolean
  hasSession: boolean
  starting: boolean
  onStart: (input: ImpersonationInput) => void
  onEnd: (impersonationId: string) => void
  endPending: boolean
}) {
  const [targetId, setTargetId] = useState<string>('')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState<number>(30)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const targets = data?.targets ?? []
  const selected = useMemo(
    () => targets.find((t) => t.id === targetId) ?? null,
    [targets, targetId]
  )
  const reasonValid = reason.trim().length >= 10
  const canSubmit = !!selected && reasonValid

  const active = data?.active ?? null

  return (
    <section aria-label="Operar como usuário" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <UserRoundCog className="size-4 text-muted-foreground" aria-hidden /> Operar como usuário
        </h2>
        <p className="text-xs text-muted-foreground">impersonação auditada · banner visível · prazo máximo 60 min</p>
      </div>
      <div className="space-y-4 p-4">
        {!hasSession && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            A impersonação exige autenticação por senha (e-mail + senha no gate de entrada). Perfis de
            demonstração não podem operar como outro usuário.
          </p>
        )}

        {active ? (
          /* Estado excepcional: impersonação ativa visível com permissão de leitura */
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Operando como {active.targetName}
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
                {active.reason} · termina {fmtDateTime(active.expiresAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => active && onEnd(active.id)}
              disabled={endPending}
            >
              Encerrar agora
            </Button>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-44 w-full rounded-lg" />
        ) : (
          <form
            className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit) setConfirmOpen(true)
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="imp-target">Usuário-alvo</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="imp-target" aria-label="Selecionar usuário-alvo">
                  <SelectValue placeholder={targets.length ? 'Selecionar usuário' : 'Sem alvos'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {targets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {ROLE_LABEL[t.role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <p className="text-[11px] text-muted-foreground">{selected.email}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-reason">
                Motivo <span className="text-muted-foreground">(mínimo 10 caracteres — registrado na auditoria)</span>
              </Label>
              <Textarea
                id="imp-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Reproduzir o problema relatado no ticket #2091 (pauta não publica)."
                rows={2}
                maxLength={500}
                aria-invalid={reason.length > 0 && !reasonValid}
                aria-describedby="imp-reason-hint"
              />
              <p id="imp-reason-hint" className="text-[11px] text-muted-foreground">
                {reason.trim().length}/10 caracteres mínimos
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-minutes">Prazo</Label>
              <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
                <SelectTrigger id="imp-minutes" className="w-28" aria-label="Prazo em minutos">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTES_OPTIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" className="w-full md:w-auto" disabled={!canSubmit || starting}>
                <UserRoundCog className="size-4" /> {starting ? 'Iniciando…' : 'Operar como…'}
              </Button>
            </div>
          </form>
        )}

        {/* Confirmação forte — a ação troca o ator da sessão inteira */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
                Operar como {selected?.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Você passará a operar como <strong>{selected?.name}</strong> (
                {ROLE_LABEL[selected?.role ?? 'tenant_admin']}
                {selected?.jobTitle ? ` · ${selected.jobTitle}` : ''}); um banner âmbar ficará visível
                em todos os módulos; todas as ações serão auditadas com o seu usuário de suporte
                (motivo: “{reason.trim()}”), com prazo de {minutes} minutos e encerramento manual ou
                automático.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (selected && canSubmit) {
                    onStart({ target: selected, reason: reason.trim(), minutes })
                    setConfirmOpen(false)
                  }
                }}
              >
                Confirmar e operar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  )
}

// ─── Seção: histórico ───────────────────────────────────────────────────────

function HistorySection({ history, isLoading }: { history: SupportImpersonationView[]; isLoading: boolean }) {
  return (
    <section aria-label="Histórico de impersonações" className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted-foreground" aria-hidden /> Histórico de impersonações
        </h2>
        <p className="text-xs text-muted-foreground">ativas primeiro · todas as ações ficam na auditoria do tenant</p>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma impersonação registrada — o suporte ainda não operou como outro usuário.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Histórico de impersonações de suporte</caption>
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">Suporte</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Alvo</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Motivo</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Início</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Prazo</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Fim</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {history.map((imp) => (
                <tr key={imp.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">{imp.supportName}</td>
                  <td className="px-4 py-3">{imp.targetName}</td>
                  <td className="max-w-64 px-4 py-3">
                    <span className="line-clamp-2 text-xs text-muted-foreground" title={imp.reason}>
                      {imp.reason}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">{fmtDateTime(imp.startedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">{fmtDateTime(imp.expiresAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">
                    {imp.endedAt ? fmtDateTime(imp.endedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {imp.active ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        <Clock className="size-3" /> Ativa
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Encerrada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function SupportModule() {
  const can = useApp((s) => s.can)
  const actor = useApp((s) => s.actor)
  const setActor = useApp((s) => s.setActor)
  const queryClient = useQueryClient()
  const me = useMe()

  const canRead = can('platform.read')
  const canAck = can('platform.manage')

  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => apiFetch<SystemStatusWithAlerts>('/api/v1/platform/system-status'),
    enabled: canRead,
    refetchInterval: 30_000,
  })
  const alerts = useQuery({
    queryKey: ['platform-alerts'],
    queryFn: () => apiFetch<AlertsPayload>('/api/v1/platform/alerts'),
    enabled: canRead,
    refetchInterval: 30_000,
  })
  const impersonations = useQuery({
    queryKey: ['platform-impersonations'],
    queryFn: () => apiFetch<ImpersonationsPayload>('/api/v1/platform/impersonations'),
    enabled: canRead,
  })
  // Fase 21 — agendamentos do scheduler :3005 (estado do export.watchdog no card).
  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => schedulesApi.list(),
    enabled: canRead,
    refetchInterval: 30_000,
  })
  const watchdogJob = schedules.data?.jobs.find((j) => j.kind === 'export.watchdog')

  const ackAlert = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ alert: PlatformAlertView }>(`/api/v1/platform/alerts/${id}/ack`, { method: 'POST' }),
    onSuccess: (res) => {
      toast.success('Alerta reconhecido', {
        description: `${res.alert.kind} — registrado por ${res.alert.ackBy}.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['platform-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['system-status'] })
    },
    onError: (err) => {
      toast.error('Falha ao reconhecer', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  /** Inicia a impersonação: POST → /auth/me → troca de ator (banner no topbar). */
  const startImpersonation = useMutation({
    mutationFn: async (input: { target: ImpersonationTarget; reason: string; minutes: number }) => {
      const created = await apiFetch<SupportImpersonationView>('/api/v1/platform/impersonations', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: input.target.id,
          reason: input.reason.trim(),
          minutes: input.minutes,
        }),
      })
      const meActor = await fetchMeActor()
      if (!meActor) {
        throw new Error('Sessão não encontrada após iniciar a impersonação — entre novamente.')
      }
      return { created, meActor }
    },
    onSuccess: ({ created, meActor }, vars) => {
      setActor(meActor.id, actorFromMe(meActor))
      // O ator trocou: TODOS os dados em cache pertencem ao escopo anterior.
      void queryClient.invalidateQueries()
      toast.success(`Operando como ${vars.target.name}`, {
        description: `Banner ativo no topo · prazo de ${vars.minutes} min · auditoria ${created.id.slice(-6)}.`,
      })
    },
    onError: (err) => {
      toast.error('Não foi possível iniciar a impersonação', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  /** Encerra a impersonação atual (banner/topbar ou estado ativo) e volta ao suporte. */
  const endImpersonation = useMutation({
    mutationFn: async (impersonationId: string) => {
      await apiFetch<SupportImpersonationView>(`/api/v1/platform/impersonations/${impersonationId}/end`, {
        method: 'POST',
      })
      const meActor = await fetchMeActor()
      if (!meActor) {
        throw new Error('Sessão não encontrada após encerrar — entre novamente.')
      }
      return meActor
    },
    onSuccess: (meActor) => {
      setActor(meActor.id, actorFromMe(meActor))
      void queryClient.invalidateQueries()
      toast.success('Impersonação encerrada', {
        description: 'Você voltou a operar com o seu próprio usuário de suporte.',
      })
    },
    onError: (err) => {
      toast.error('Falha ao encerrar a impersonação', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  // ─── Restrição: conteúdo exige platform.read ─────────────────────────────
  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={<Headset className="size-5" />}
          title="Suporte da Plataforma"
          description="Operar como outro usuário com auditoria e prazo, acompanhar alertas persistentes e a saúde dos serviços."
        />
        {actor?.impersonation ? (
          <EmptyState
            icon={<ShieldAlert className="size-8" />}
            title="Você está operando como outro usuário"
            description={`Suporte ${actor.impersonation.supportName} opera como ${actor.impersonation.targetName} neste momento. Encerre a impersonação pelo banner âmbar no topo da tela para voltar às ferramentas de suporte.`}
          />
        ) : (
          <EmptyState
            icon={<Lock className="size-8" />}
            title="Acesso restrito ao suporte da plataforma"
            description="Este módulo é exclusivo dos papéis Suporte da Plataforma (platform_support) e Operação da Plataforma (platform_owner)."
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Headset className="size-5" />}
        title="Suporte da Plataforma"
        description="Saúde operacional, alertas persistentes e impersonação auditada para atender as Câmaras com transparência total."
        actions={
          <Button variant="outline" size="sm" onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ['system-status'] })
            void queryClient.invalidateQueries({ queryKey: ['platform-alerts'] })
            void queryClient.invalidateQueries({ queryKey: ['platform-impersonations'] })
            void queryClient.invalidateQueries({ queryKey: ['export-watchdog'] })
            void queryClient.invalidateQueries({ queryKey: ['schedules'] })
          }}>
            <RefreshCw className={status.isFetching ? 'animate-spin' : undefined} /> Atualizar
          </Button>
        }
      />

      {status.isError ? (
        <EmptyState
          icon={<AlertTriangle className="size-8" />}
          title="Não foi possível carregar a saúde da plataforma"
          description={status.error instanceof Error ? status.error.message : 'Erro inesperado.'}
          action={
            <Button variant="outline" size="sm" onClick={() => status.refetch()}>
              <RefreshCw /> Tentar novamente
            </Button>
          }
        />
      ) : (
        <HealthSummary status={status.data} />
      )}

      <AlertsSection
        alerts={alerts.data?.alerts ?? status.data?.platformAlerts ?? []}
        isLoading={alerts.isLoading && status.isLoading}
        canAck={canAck}
        onAck={(id) => ackAlert.mutate(id)}
        ackPending={ackAlert.isPending}
      />

      <WatchdogSection watchdogJob={watchdogJob} />

      {can('impersonation.manage') ? (
        <ImpersonationSection
          data={impersonations.data}
          isLoading={impersonations.isLoading}
          hasSession={!!me.data}
          starting={startImpersonation.isPending}
          onStart={(input) => startImpersonation.mutate(input)}
          onEnd={(id) => endImpersonation.mutate(id)}
          endPending={endImpersonation.isPending}
        />
      ) : (
        <section aria-label="Operar como usuário" className="rounded-xl border bg-card p-4">
          <EmptyState
            icon={<UserRoundCog className="size-8" />}
            title="Impersonação indisponível para este papel"
            description="Apenas Suporte da Plataforma e Operação da Plataforma podem operar como outro usuário (permissão impersonation.manage)."
          />
        </section>
      )}

      <HistorySection
        history={impersonations.data?.history ?? []}
        isLoading={impersonations.isLoading}
      />
    </div>
  )
}
