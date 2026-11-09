'use client'

/**
 * Fase 8 — Console da Plataforma (SaaS): KPIs globais, tenants com uso e health
 * score, onboarding de novas Câmaras e gestão de planos/entitlements.
 * Fase 10 — aba Faturamento. Fase 16 — aba Sistema (observabilidade) e ações
 * por tenant de exportação integral/encerramento seguro no ciclo de vida.
 * Fase 20 — "Exportar dados" vira JOB ASSÍNCRONO: POST cria o ExportJob (202) e
 * a Visão Geral mostra o progresso (0–100%) com polling de 1s; ao concluir,
 * botão de download (regenerado deterministicamente no momento do download) e
 * toast; job com falha mostra erro + nova tentativa.
 * Acesso exclusivo de platform_owner (RBAC server-side; demais papéis veem EmptyState).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  Building2,
  Download,
  FileJson,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  PowerOff,
  ReceiptText,
  RotateCcw,
  Users,
  CalendarDays,
  Vote,
  Webhook,
  TrendingUp,
} from 'lucide-react'

import { platformApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { EXPORT_JOB_STATUS_LABEL, PLAN_STATUS_LABEL } from '@/lib/contracts'
import type { ExportJobView } from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'

import BillingTab from './billing-tab'
import SystemTab from './system-tab'

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']

type TenantRow = { id: string; name: string; slug: string; active: boolean }

/** Fetch próprio com fallback demo (x-actor-id) — usado pelo fluxo de export. */
async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function healthBadge(score: number) {
  if (score >= 70) return { label: `Saudável · ${score}`, className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
  if (score >= 40) return { label: `Atenção · ${score}`, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
  return { label: `Crítico · ${score}`, className: 'bg-red-500/15 text-red-700 dark:text-red-300' }
}

function subscriptionBadge(status: string | undefined) {
  if (!status) return <Badge variant="outline">Sem assinatura</Badge>
  const map: Record<string, string> = {
    trial: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    past_due: 'bg-red-500/15 text-red-700 dark:text-red-300',
    canceled: 'bg-muted text-muted-foreground',
  }
  return <Badge className={map[status] ?? 'bg-muted'}>{PLAN_STATUS_LABEL[status] ?? status}</Badge>
}

export default function ConsoleModule() {
  const role = useApp((s) => s.actor?.role)
  const queryClient = useQueryClient()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [planDialogTenant, setPlanDialogTenant] = useState<string | null>(null)
  const [newPlanOpen, setNewPlanOpen] = useState(false)
  const [closeTarget, setCloseTarget] = useState<TenantRow | null>(null)
  /** Tenant rastreado pelo painel de exportação (override explícito; default
   * derivado durante o render: primeiro tenant — o seed traz um job done da
   * Vila Nova, visível ao abrir sem efeito de sincronização). */
  const [exportTargetId, setExportTargetId] = useState<string | null>(null)

  const isOwner = role === 'platform_owner'
  const overview = useQuery({
    queryKey: ['platform-overview'],
    queryFn: platformApi.overview,
    enabled: isOwner,
  })
  const tenants = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: platformApi.listTenants,
    enabled: isOwner,
  })
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: platformApi.listPlans,
    enabled: isOwner,
  })

  // Painel de exportação: override explícito ou primeiro tenant (estado
  // derivado — sem efeito; muda de null para o tenant assim que a lista carrega).
  const exportTarget = useMemo(
    () =>
      tenants.data?.tenants.find((t) => t.id === exportTargetId) ??
      tenants.data?.tenants[0] ??
      null,
    [tenants.data, exportTargetId]
  )

  // Fase 20 — último job do tenant rastreado; polling de 1s enquanto corre.
  const lastExportJob = useQuery({
    queryKey: ['platform-export-job', exportTarget?.id],
    queryFn: () => jsonFetch<{ job: ExportJobView | null }>(`/api/v1/platform/tenants/${exportTarget?.id}/export`),
    enabled: isOwner && !!exportTarget,
    refetchInterval: (query) => {
      const job = query.state.data?.job
      return job && (job.status === 'pending' || job.status === 'running') ? 1_000 : false
    },
  })

  // Toast de término/falha — dispara UMA vez por mudança de estado do job.
  const lastJobStatusRef = useRef<string | null>(null)
  useEffect(() => {
    const job = lastExportJob.data?.job
    if (!job) return
    if (lastJobStatusRef.current === job.status) return
    const previous = lastJobStatusRef.current
    lastJobStatusRef.current = job.status
    if (job.status === 'done' && previous && previous !== 'done') {
      toast.success(`Exportação de ${exportTarget?.name ?? 'tenant'} concluída`, {
        description: 'Arquivo pronto para download na Visão Geral.',
      })
    } else if (job.status === 'failed' && previous && previous !== 'failed') {
      toast.error('A exportação falhou', {
        description: job.error ?? 'Consulte o painel de exportação para tentar novamente.',
      })
    }
  }, [lastExportJob.data, exportTarget])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-overview'] })
    queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
  }

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => platformApi.updateTenant(id, { active }),
    onSuccess: () => {
      toast.success('Tenant atualizado')
      invalidate()
    },
  })

  // Fase 20 — exportação integral como JOB ASSÍNCRONO: POST cria o job (202) e
  // o painel da Visão Geral acompanha o progresso com polling de 1s.
  const startExport = useMutation({
    mutationFn: async (t: TenantRow) => {
      setExportTargetId(t.id)
      lastJobStatusRef.current = null
      return jsonFetch<{ job: ExportJobView }>(`/api/v1/platform/tenants/${t.id}/export`, {
        method: 'POST',
      })
    },
    onSuccess: ({ job }, t) => {
      toast.success(`Exportação de ${t.name} iniciada`, {
        description: `Job ${job.id.slice(-6)} — o progresso aparece na Visão Geral.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['platform-export-job', t.id] })
    },
    onError: (err) => {
      toast.error('Falha ao iniciar a exportação', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  // Download do job DONE — payload regenerado no servidor no momento do
  // download (snapshot consistente) e entregue como blob com nome oficial.
  const downloadExport = useMutation({
    mutationFn: async (input: { job: ExportJobView; tenant: TenantRow }) => {
      const headers = new Headers()
      const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
      if (actorId) headers.set('x-actor-id', actorId)
      const res = await fetch(`/api/v1/platform/exports/${input.job.id}/download`, {
        headers,
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(problem?.detail ?? 'Falha ao baixar a exportação.')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        `export-${input.tenant.slug}-${input.job.id}.json`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      return { blob, filename }
    },
    onSuccess: ({ blob, filename }) => {
      toast.success('Exportação baixada', {
        description: `${filename} · ${fmtBytes(blob.size)} — snapshot do momento do download.`,
      })
    },
    onError: (err) => {
      toast.error('Falha no download', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Console da Plataforma"
          description="Operação multi-Câmara do edocBR Plenário: tenants, planos, assinaturas, uso e saúde."
        />
        <EmptyState
          icon={<Building2 className="size-8" />}
          title="Acesso exclusivo da operação da plataforma"
          description="Este módulo é restrito ao papel Operação da Plataforma (platform_owner). Troque o perfil de acesso para visualizar os indicadores globais do SaaS."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Console da Plataforma"
        description="Operação multi-Câmara do edocBR Plenário: tenants, planos, assinaturas, uso e saúde."
        actions={
          <Button onClick={() => setOnboardingOpen(true)}>
            <Plus /> Nova Câmara
          </Button>
        }
      />

      {/* Abas do console: visão geral (Fase 8) + faturamento (Fase 10) + sistema (Fase 16) */}
      <Tabs defaultValue="overview" className="gap-4">
        <TabsList>
          <TabsTrigger value="overview">
            <LayoutDashboard className="size-3.5" /> Visão Geral
          </TabsTrigger>
          <TabsTrigger value="billing">
            <ReceiptText className="size-3.5" /> Faturamento
          </TabsTrigger>
          <TabsTrigger value="sistema">
            <Activity className="size-3.5" /> Sistema
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
      <section aria-label="Indicadores globais" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { icon: <Landmark className="size-4" />, label: 'Câmaras ativas', value: overview.data ? `${overview.data.overview.tenants.active}/${overview.data.overview.tenants.total}` : null },
          { icon: <CalendarDays className="size-4" />, label: 'Sessões no mês', value: overview.data?.overview.sessionsThisMonth },
          { icon: <Vote className="size-4" />, label: 'Votos computados', value: overview.data?.overview.votesTotal },
          { icon: <TrendingUp className="size-4" />, label: 'Eventos publicados', value: overview.data?.overview.outboxPublished },
          { icon: <Webhook className="size-4" />, label: 'Webhooks em dead-letter', value: overview.data?.overview.webhooksDead },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              {kpi.icon}
              <p className="text-xs font-medium uppercase tracking-wide">{kpi.label}</p>
            </div>
            {kpi.value === null || kpi.value === undefined ? (
              <Skeleton className="mt-2 h-8 w-16" />
            ) : (
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{kpi.value}</p>
            )}
          </div>
        ))}
      </section>

      {/* Tenants */}
      <section aria-label="Câmaras (tenants)" className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Câmaras contratantes</h2>
          <p className="text-xs text-muted-foreground">{tenants.data?.tenants.length ?? '…'} tenants · uso agregado sem conteúdo legislativo</p>
        </div>
        {tenants.isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : tenants.data && tenants.data.tenants.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Câmara</th>
                  <th className="px-4 py-2.5 font-medium">Plano</th>
                  <th className="px-4 py-2.5 font-medium">Assinatura</th>
                  <th className="px-4 py-2.5 font-medium">Uso (veread./sessões/matrérias/votos)</th>
                  <th className="px-4 py-2.5 font-medium">Health score</th>
                  <th className="px-4 py-2.5 font-medium">Ativa</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {tenants.data.tenants.map((t) => {
                  const hb = healthBadge(t.healthScore)
                  return (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.slug} · {t.city}/{t.uf} · desde {fmtDate(t.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        {t.subscription ? (
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant="outline" className="capitalize">{t.subscription.plan.name}</Badge>
                            <span className="text-[11px] text-muted-foreground">
                              R$ {(t.subscription.plan.priceCents / 100).toLocaleString('pt-BR')}/mês
                            </span>
                          </div>
                        ) : (
                          <Badge variant="outline">—</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          {subscriptionBadge(t.subscription?.status)}
                          {t.subscription?.trialEndsAt && (
                            <span className="text-[11px] text-muted-foreground">trial até {fmtDate(t.subscription.trialEndsAt)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Users className="size-3" /> {t.usage.parliamentarians}</span>
                          <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" /> {t.usage.sessions}</span>
                          <span>{t.usage.matters}</span>
                          <span className="inline-flex items-center gap-1"><Vote className="size-3" /> {t.usage.votes}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={hb.className}>
                          <HeartPulse className="size-3" /> {hb.label}
                        </Badge>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t.healthDetail.sessionsLast30d} sessões/30d · {t.healthDetail.deadWebhooks} dead
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={t.active}
                            disabled={toggleActive.isPending}
                            onCheckedChange={(v) => toggleActive.mutate({ id: t.id, active: v })}
                            aria-label={`Ativar ou desativar ${t.name}`}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPlanDialogTenant(t.id)}
                            aria-label={`Trocar plano de ${t.name}`}
                          >
                            <Pencil /> Plano
                          </Button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Ações de ${t.name}`}
                              disabled={startExport.isPending}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startExport.mutate(t)}>
                              <Download className="size-4" /> Exportar dados
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!t.active}
                              onClick={() => setCloseTarget(t)}
                            >
                              <PowerOff className="size-4" /> Encerrar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState icon={<Landmark className="size-7" />} title="Nenhuma Câmara cadastrada" description="Use “Nova Câmara” para fazer o onboarding do primeiro tenant." />
          </div>
        )}
      </section>

      {/* Fase 20 — painel da exportação assíncrona (progresso + download) */}
      <section aria-label="Exportação assíncrona de dados" className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileJson className="size-4 text-muted-foreground" aria-hidden /> Exportação de dados (assíncrona)
          </h2>
          <p className="text-xs text-muted-foreground">
            {exportTarget
              ? `Job mais recente de ${exportTarget.name} · JSON integral sem segredos`
              : 'carregando…'}
          </p>
        </div>
        <div className="space-y-3 p-4">
          {lastExportJob.isLoading || !exportTarget ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ) : !lastExportJob.data?.job ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma exportação iniciada para {exportTarget.name} — use “Exportar dados” na
              linha da Câmara na tabela acima.
            </p>
          ) : (
            (() => {
              const job = lastExportJob.data.job
              const statusLabel = EXPORT_JOB_STATUS_LABEL[job.status] ?? job.status
              const busy = job.status === 'pending' || job.status === 'running'
              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="flex min-w-0 items-center gap-2">
                      {busy ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
                      ) : job.status === 'done' ? (
                        <Download className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      ) : (
                        <RotateCcw className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
                      )}
                      <span className="font-medium">{statusLabel}</span>
                      <span className="text-xs text-muted-foreground">
                        job {job.id.slice(-6)} · {fmtDateTime(job.createdAt)}
                      </span>
                    </p>
                    <span
                      className="text-sm font-bold tabular-nums"
                      aria-label={`Progresso da exportação: ${job.progress} por cento`}
                    >
                      {job.progress}%
                    </span>
                  </div>
                  <Progress value={job.progress} aria-label={`Progresso ${job.progress}%`} />
                  {job.status === 'failed' && (
                    <p
                      role="alert"
                      className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
                    >
                      <strong className="block font-semibold">A exportação falhou</strong>
                      {job.error ?? 'Erro não registrado.'}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {job.status === 'done' && exportTarget ? (
                      <Button
                        size="sm"
                        onClick={() => downloadExport.mutate({ job, tenant: exportTarget })}
                        disabled={downloadExport.isPending}
                      >
                        {downloadExport.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Download />
                        )}
                        Baixar exportação
                      </Button>
                    ) : null}
                    {job.status === 'failed' && exportTarget ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startExport.mutate(exportTarget)}
                        disabled={startExport.isPending}
                      >
                        <RotateCcw /> Tentar novamente
                      </Button>
                    ) : null}
                    {busy && (
                      <p className="text-xs text-muted-foreground">
                        Processando em segundo plano — o progresso atualiza automaticamente (1s).
                      </p>
                    )}
                    {!busy && job.finishedAt ? (
                      <p className="text-xs text-muted-foreground">
                        Concluído em {fmtDateTime(job.finishedAt)}.
                      </p>
                    ) : null}
                  </div>
                </>
              )
            })()
          )}
        </div>
      </section>

      {/* Planos */}
      <section aria-label="Planos e entitlements" className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Planos e entitlements</h2>
          <Button variant="outline" size="sm" onClick={() => setNewPlanOpen(true)}>
            <Plus /> Novo plano
          </Button>
        </div>
        {plans.isLoading ? (
          <div className="grid gap-4 p-4 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-3">
            {plans.data?.plans.map((p) => (
              <div key={p.id} className={`rounded-lg border p-4 ${p.active ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-base font-bold capitalize">{p.name}</h3>
                  {!p.active && <Badge variant="outline">Inativo</Badge>}
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  R$ {(p.priceCents / 100).toLocaleString('pt-BR')}
                  <span className="text-xs font-normal text-muted-foreground">/mês</span>
                </p>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <li>{p.limits.maxParliamentarians ? `Até ${p.limits.maxParliamentarians} vereadores` : 'Vereadores ilimitados'}</li>
                  <li>{p.limits.maxSessionsPerMonth ? `${p.limits.maxSessionsPerMonth} sessões/mês` : 'Sessões ilimitadas'}</li>
                  <li>Pacote local: até {p.limits.maxTransferPackageMiB ?? 512} MiB por sessão</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.limits.features.length > 0 ? (
                    p.limits.features.map((f) => (
                      <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Sem recursos premium</span>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{p.subscriptions ?? 0} assinatura(s)</p>
              </div>
            ))}
          </div>
        )}
      </section>
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <BillingTab tenants={tenants.data?.tenants} />
        </TabsContent>

        <TabsContent value="sistema" className="space-y-6">
          <SystemTab />
        </TabsContent>
      </Tabs>

      <OnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} plans={plans.data?.plans ?? []} onDone={invalidate} />
      <ChangePlanDialog tenantId={planDialogTenant} onOpenChange={(o) => !o && setPlanDialogTenant(null)} plans={plans.data?.plans ?? []} onDone={invalidate} />
      <NewPlanDialog open={newPlanOpen} onOpenChange={setNewPlanOpen} onDone={() => queryClient.invalidateQueries({ queryKey: ['platform-plans'] })} />
      <CloseTenantDialog tenant={closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)} onDone={invalidate} />
    </div>
  )
}

function OnboardingDialog({
  open,
  onOpenChange,
  plans,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  plans: Array<{ id: string; name: string }>
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('MG')
  const [planId, setPlanId] = useState('')

  const create = useMutation({
    mutationFn: () => {
      const finalSlug = slug.trim() || name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      return platformApi.createTenant({ name: name.trim(), slug: finalSlug, city: city.trim(), uf, planId })
    },
    onSuccess: () => {
      toast.success('Câmara criada', { description: 'Onboarding concluído: tenant, legislatura e administrador trial.' })
      setName('')
      setSlug('')
      setCity('')
      setPlanId('')
      onOpenChange(false)
      onDone()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="size-5 text-primary" /> Onboarding de nova Câmara
          </DialogTitle>
          <DialogDescription>
            Cria o tenant com white-label padrão, legislatura atual, usuário administrador e assinatura trial de 14 dias.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tenant-name">Nome institucional</Label>
            <Input id="tenant-name" placeholder="Câmara Municipal de Campo Rico" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tenant-slug">Slug (opcional)</Label>
              <Input id="tenant-slug" placeholder="camara-campo-rico" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-uf">UF</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger id="tenant-uf"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UFS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-city">Cidade</Label>
            <Input id="tenant-city" placeholder="Campo Rico" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Plano inicial</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="Selecione o plano" /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name.trim() || !city.trim() || !planId || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Criando…' : 'Criar Câmara'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChangePlanDialog({
  tenantId,
  onOpenChange,
  plans,
  onDone,
}: {
  tenantId: string | null
  onOpenChange: (v: boolean) => void
  plans: Array<{ id: string; name: string }>
  onDone: () => void
}) {
  const [planId, setPlanId] = useState('')
  const update = useMutation({
    mutationFn: (id: string) => platformApi.updateTenant(id, { planId }),
    onSuccess: () => {
      toast.success('Plano alterado', { description: 'Os entitlements do tenant foram atualizados.' })
      onOpenChange(false)
      onDone()
    },
  })
  return (
    <Dialog open={!!tenantId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Trocar plano da Câmara</DialogTitle>
          <DialogDescription>O novo plano define limites e recursos habilitados (entitlements).</DialogDescription>
        </DialogHeader>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger><SelectValue placeholder="Selecione o novo plano" /></SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!planId || update.isPending} onClick={() => tenantId && update.mutate(tenantId)}>
            Confirmar troca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewPlanDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('299')
  const [maxParl, setMaxParl] = useState('10')
  const [maxSess, setMaxSess] = useState('12')
  const [maxTransferMiB, setMaxTransferMiB] = useState('512')
  const [features, setFeatures] = useState('')

  const create = useMutation({
    mutationFn: () =>
      platformApi.createPlan({
        name: name.trim().toLowerCase(),
        priceCents: Math.round(Number(price.replace(',', '.')) * 100) || 0,
        limits: {
          maxParliamentarians: Number(maxParl) || null,
          maxSessionsPerMonth: Number(maxSess) || null,
          maxTransferPackageMiB: Number(maxTransferMiB),
          features: features.split(',').map((f) => f.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success('Plano criado')
      setName('')
      setFeatures('')
      onOpenChange(false)
      onDone()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo plano comercial</DialogTitle>
          <DialogDescription>Defina preço, limites de uso e recursos habilitados (features).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Nome</Label>
              <Input id="plan-name" placeholder="premium" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Preço mensal (R$)</Label>
              <Input id="plan-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-transfer-mib">Pacote local por sessão (MiB, 1–512)</Label>
            <Input id="plan-transfer-mib" inputMode="numeric" min={1} max={512}
              value={maxTransferMiB} onChange={(e) => setMaxTransferMiB(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-parl">Máx. vereadores</Label>
              <Input id="plan-parl" inputMode="numeric" value={maxParl} onChange={(e) => setMaxParl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-sess">Sessões/mês</Label>
              <Input id="plan-sess" inputMode="numeric" value={maxSess} onChange={(e) => setMaxSess(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-features">Recursos (separados por vírgula)</Label>
            <Textarea id="plan-features" placeholder="ai_assist, white_label_avancado" value={features} onChange={(e) => setFeatures(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name.trim() || !Number.isInteger(Number(maxTransferMiB)) ||
            Number(maxTransferMiB) < 1 || Number(maxTransferMiB) > 512 || create.isPending}
            onClick={() => create.mutate()}>
            {create.isPending ? 'Criando…' : 'Criar plano'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Fase 16 — encerramento formal do tenant (destrutivo, com dupla confirmação):
 * justificativa obrigatória (10–500) + digitação exata de "ENCERRAR". O botão
 * permanece desabilitado até os dois critérios serem válidos. Os dados NUNCA
 * são apagados (retenção LGPD + cadeia de auditoria).
 */
function CloseTenantDialog({
  tenant,
  onOpenChange,
  onDone,
}: {
  tenant: TenantRow | null
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [justification, setJustification] = useState('')
  const [confirmText, setConfirmText] = useState('')

  const close = useMutation({
    mutationFn: async () => {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
      if (actorId) headers.set('x-actor-id', actorId)
      const res = await fetch(`/api/v1/platform/tenants/${tenant?.id ?? ''}/close`, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ justification: justification.trim(), confirm: 'ENCERRAR' }),
      })
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; detail?: string }
        | null
      if (!res.ok) throw new Error(body?.detail ?? 'Falha ao encerrar o tenant.')
      return body?.message ?? 'Tenant encerrado.'
    },
    onSuccess: (message) => {
      toast.success('Tenant encerrado', { description: message })
      setJustification('')
      setConfirmText('')
      onOpenChange(false)
      onDone()
    },
    onError: (err) => {
      toast.error('Falha ao encerrar', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  const justificationLength = justification.trim().length
  const justificationOk = justificationLength >= 10 && justificationLength <= 500
  const confirmOk = confirmText === 'ENCERRAR'
  const canSubmit = justificationOk && confirmOk && !close.isPending

  const resetAndClose = () => {
    setJustification('')
    setConfirmText('')
    onOpenChange(false)
  }

  return (
    <AlertDialog open={!!tenant} onOpenChange={(o) => (o ? undefined : resetAndClose())}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <PowerOff className="size-5 text-destructive" />
            Encerrar {tenant?.name}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Encerramento formal do contrato: operação destrutiva auditada com justificativa,
            reversível apenas por reativação pelo console da plataforma.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <li>• Todas as sessões de login dos usuários desta Câmara serão revogadas imediatamente.</li>
          <li>• A assinatura será cancelada (faturamento encerrado).</li>
          <li>• Os usuários passarão a receber acesso bloqueado (403) até a reativação.</li>
          <li>• Nenhum dado é apagado — permanece preservado por retenção (LGPD) e cadeia de auditoria.</li>
        </ul>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="close-justification">
              Justificativa (mín. 10, máx. 500 caracteres)
            </Label>
            <Textarea
              id="close-justification"
              placeholder="Motivo do encerramento do contrato…"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              aria-invalid={justification.length > 0 && !justificationOk}
              disabled={close.isPending}
            />
            <p className="text-[11px] text-muted-foreground">
              {justificationLength}/500 caracteres (mínimo 10)
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="close-confirm">
              Para confirmar, digite <span className="font-mono font-bold">ENCERRAR</span>
            </Label>
            <Input
              id="close-confirm"
              placeholder="ENCERRAR"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              disabled={close.isPending}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={close.isPending}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => close.mutate()}
          >
            <PowerOff />
            {close.isPending ? 'Encerrando…' : 'Encerrar tenant'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
