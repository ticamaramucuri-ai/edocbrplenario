'use client'

/**
 * Módulo Crescimento (Onda 5 / Fase 24 — ADR-025).
 *
 * Painel de growth do SaaS para a operação da plataforma:
 *  · Cards de métricas de negócio (tenants ativos, MRR simulado, churn 90d,
 *    trials e NPS consolidado da versão) — GET /platform/metrics;
 *  · Saúde por tenant (health score anti-churn determinístico com barra
 *    colorida por bucket, métricas-chave 30d, tendência vs. captura anterior
 *    e captura forçada) — GET/POST /platform/tenants/(:id/)health;
 *  · Fila de self-onboarding (pedidos públicos pendentes com ativação de
 *    trial + senha temporária exibida UMA vez, e rejeição com nota
 *    obrigatória; histórico colapsável) — /platform/onboarding.
 *
 * RBAC de UI: leitura exige platform.read (owner + support); mutações
 * (ativar/rejeitar/capturar) exigem platform.manage (owner) — a autorização
 * REAL é server-side. Erros de API viram toast pelo handler global
 * (legis:api-error em page.tsx).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Building2,
  Camera,
  CheckCircle2,
  Copy,
  Gauge,
  Hourglass,
  Landmark,
  Minus,
  RefreshCw,
  Rocket,
  ShieldAlert,
  TrendingUp,
  Users2,
} from 'lucide-react'

import { growthApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import {
  HEALTH_BUCKET_LABEL,
  ONBOARDING_STATUS_LABEL,
  type OnboardingActivationView,
  type OnboardingRequestView,
  type PlatformMetricsView,
  type TenantHealthView,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

// ─── Helpers visuais ────────────────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const BUCKET_BAR: Record<TenantHealthView['bucket'], string> = {
  saudavel: '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  atencao: '[&_[data-slot=progress-indicator]]:bg-amber-500',
  risco: '[&_[data-slot=progress-indicator]]:bg-rose-600',
}

const BUCKET_BADGE: Record<TenantHealthView['bucket'], string> = {
  saudavel:
    'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  atencao: 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400',
  risco: 'border-rose-600/30 bg-rose-600/10 text-rose-700 dark:text-rose-400',
}

const STATUS_BADGE: Record<OnboardingRequestView['status'], string> = {
  pendente: 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400',
  ativada:
    'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  rejeitada: 'border-rose-600/30 bg-rose-600/10 text-rose-700 dark:text-rose-400',
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 w-7 p-0"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`))
      }}
      aria-label={`Copiar ${label.toLowerCase()}`}
    >
      <Copy className="size-3.5" />
    </Button>
  )
}

// ─── Cards de métricas (padrão KpiCard do módulo Analytics) ─────────────────

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

function MetricsSection({ metrics }: { metrics: PlatformMetricsView }) {
  return (
    <section aria-label="Métricas de negócio" className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Tenants ativos"
          value={String(metrics.activeTenants)}
          hint="Câmaras operando na plataforma agora"
          icon={<Building2 />}
        />
        <KpiCard
          title="MRR simulado"
          value={brl.format(metrics.mrrCents / 100)}
          hint="Assinaturas ativas × preço do plano (trials não contam)"
          icon={<TrendingUp />}
        />
        <KpiCard
          title="Churn 90d"
          value={`${metrics.churn90d.toLocaleString('pt-BR')}%`}
          hint="Tenants desativados nos últimos 90 dias"
          icon={<ArrowDownRight />}
        />
        <KpiCard
          title="Trials ativos"
          value={String(metrics.trials)}
          hint="Trial vigente (Tenant.trialEndsAt ou assinatura trial)"
          icon={<Hourglass />}
        />
        <KpiCard
          title="NPS médio (0–10)"
          value={metrics.npsAverage !== null ? metrics.npsAverage.toFixed(2) : '—'}
          hint={`${metrics.npsResponses} resposta(s) na versão atual`}
          icon={<Gauge />}
        />
      </div>
    </section>
  )
}

// ─── Tabela de saúde por tenant ─────────────────────────────────────────────

function TrendCell({ trend }: { trend: number | null }) {
  if (trend === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Sem captura anterior">
        <Minus className="size-3.5" aria-hidden /> —
      </span>
    )
  }
  if (trend === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums" title="Estável vs. captura anterior">
        <Minus className="size-3.5" aria-hidden /> 0
      </span>
    )
  }
  const up = trend > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-bold tabular-nums',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
      )}
      title={`${up ? '+' : ''}${trend} pontos vs. captura anterior`}
    >
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {up ? '+' : ''}
      {trend}
    </span>
  )
}

function HealthSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [capturing, setCapturing] = useState<string | null>(null)

  const healthQ = useQuery({
    queryKey: ['growth', 'tenants-health'],
    queryFn: () => growthApi.tenantsHealth(),
  })

  const capture = useMutation({
    mutationFn: (tenantId: string) => growthApi.captureHealth(tenantId),
    onSuccess: (view) => {
      void qc.invalidateQueries({ queryKey: ['growth', 'tenants-health'] })
      toast.success('Snapshot de saúde capturado', {
        description: `${view.tenantName}: ${view.score} pts (${HEALTH_BUCKET_LABEL[view.bucket]}) — captura forçada registrada.`,
      })
    },
    onSettled: () => setCapturing(null),
  })

  const tenants = healthQ.data?.tenants ?? []

  return (
    <section aria-label="Saúde por tenant" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Saúde por tenant (anti-churn)</h2>
          <p className="text-sm text-muted-foreground">
            Score determinístico 0–100 recomputado na hora: sessões · matérias · logins · webhooks
            ativos dos últimos 30 dias. A tendência compara com o último snapshot capturado
            (diário pelo agendador ou captura forçada).
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void healthQ.refetch()}
          aria-label="Recalcular saúde agora"
        >
          <RefreshCw className={cn('size-3.5', healthQ.isFetching && 'animate-spin')} /> Recalcular
        </Button>
      </div>

      {healthQ.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="Nenhum tenant ativo"
          description="Sem câmaras ativas para avaliar a saúde."
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto custom-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="w-52">Score</TableHead>
                  <TableHead className="hidden md:table-cell">Métricas 30d</TableHead>
                  <TableHead className="w-24">Tendência</TableHead>
                  <TableHead className="hidden lg:table-cell w-40">Capturado em</TableHead>
                  <TableHead className="w-36 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TableRow key={t.tenantId}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.tenantName}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {t.slug}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-8 text-sm font-bold tabular-nums">{t.score}</span>
                          <Badge variant="outline" className={cn('text-[10px]', BUCKET_BADGE[t.bucket])}>
                            {HEALTH_BUCKET_LABEL[t.bucket]}
                          </Badge>
                        </div>
                        <Progress
                          value={t.score}
                          className="h-1.5"
                          aria-label={`Health score ${t.score} de 100 (${HEALTH_BUCKET_LABEL[t.bucket]})`}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.metrics.sessions30d} sessões · {t.metrics.matters30d} matérias ·{' '}
                        {t.metrics.logins30d} logins · {t.metrics.activeWebhooks} webhooks
                      </span>
                    </TableCell>
                    <TableCell>
                      <TrendCell trend={t.trend} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
                      {fmtDateTime(t.capturedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => {
                            setCapturing(t.tenantId)
                            capture.mutate(t.tenantId)
                          }}
                          disabled={capture.isPending && capturing === t.tenantId}
                          aria-label={`Capturar snapshot de saúde de ${t.tenantName}`}
                        >
                          {capture.isPending && capturing === t.tenantId ? (
                            <RefreshCw className="size-3.5 animate-spin" />
                          ) : (
                            <Camera className="size-3.5" />
                          )}
                          Capturar agora
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Fórmula canônica (rotas · seed · agendador): sessões min(35, n×12) + matérias min(25, n) +
        logins min(30, ⌊n/2⌋) + webhooks ativos min(10, n×5) — buckets saudável ≥ 70 · atenção ≥ 40 · risco &lt; 40.
      </p>
    </section>
  )
}

// ─── Fila de onboarding ─────────────────────────────────────────────────────

/** Card de um pedido; pendentes trazem as ações de ativação/rejeição. */
function RequestCard({
  request,
  canManage,
  onActivate,
  onReject,
}: {
  request: OnboardingRequestView
  canManage: boolean
  onActivate: (r: OnboardingRequestView) => void
  onReject: (r: OnboardingRequestView) => void
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{request.chamberName}</p>
            <Badge variant="outline" className={cn('text-[10px]', STATUS_BADGE[request.status])}>
              {ONBOARDING_STATUS_LABEL[request.status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {request.city}/{request.uf} · <span className="font-mono">{request.email}</span>
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            slug: {request.slug}
          </p>
          {request.note && (
            <p className="mt-1 rounded-md bg-muted/60 px-2 py-1 text-xs leading-snug text-muted-foreground">
              Nota: {request.note}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">{fmtDateTime(request.createdAt)}</p>
        </div>
        {canManage && request.status === 'pendente' && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button size="sm" className="h-8 gap-1" onClick={() => onActivate(request)}>
              <Rocket className="size-3.5" /> Ativar trial
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 border-rose-600/40 text-rose-700 hover:bg-rose-600/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-400"
              onClick={() => onReject(request)}
            >
              <Ban className="size-3.5" /> Rejeitar
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

function OnboardingSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [activateTarget, setActivateTarget] = useState<OnboardingRequestView | null>(null)
  const [rejectTarget, setRejectTarget] = useState<OnboardingRequestView | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [activationResult, setActivationResult] = useState<OnboardingActivationView | null>(null)

  const onboardingQ = useQuery({
    queryKey: ['growth', 'onboarding'],
    queryFn: () => growthApi.onboardingRequests(),
  })

  const activate = useMutation({
    mutationFn: (id: string) => growthApi.activate(id),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['growth', 'onboarding'] })
      void qc.invalidateQueries({ queryKey: ['growth', 'tenants-health'] })
      void qc.invalidateQueries({ queryKey: ['growth', 'metrics'] })
      setActivationResult(data) // senha temporária exibida UMA vez
    },
    onSettled: () => setActivateTarget(null),
  })

  const reject = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => growthApi.reject(id, note),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['growth', 'onboarding'] })
      toast.success('Pedido rejeitado', {
        description: `${data.request.chamberName} — a nota fica registrada no histórico.`,
      })
      setRejectTarget(null)
      setRejectNote('')
    },
  })

  const requests = onboardingQ.data?.requests ?? []
  const pending = requests.filter((r) => r.status === 'pendente')
  const history = requests.filter((r) => r.status !== 'pendente')
  const noteValid = rejectNote.trim().length >= 5 && rejectNote.trim().length <= 200

  return (
    <section aria-label="Fila de onboarding" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Fila de onboarding (self-onboarding)</h2>
        <p className="text-sm text-muted-foreground">
          Pedidos públicos de criação de câmara (limite 3/h/IP). A ativação cria o tenant no plano
          profissional com trial de 14 dias e o usuário responsável com senha temporária —{' '}
          <strong className="text-foreground">exibida uma única vez</strong> (sem SMTP no sandbox).
        </p>
      </div>

      {onboardingQ.isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Nenhum pedido pendente"
          description="A fila está vazia — novos pedidos chegam pelo formulário público POST /api/v1/public/onboarding."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {pending.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              canManage={canManage}
              onActivate={(req) => setActivateTarget(req)}
              onReject={(req) => {
                setRejectTarget(req)
                setRejectNote('')
              }}
            />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <Collapsible className="rounded-xl border bg-card">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-accent/50">
            <span className="flex items-center gap-2">
              <Users2 className="size-4 text-muted-foreground" aria-hidden />
              Histórico de pedidos ({history.length})
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              ativadas e rejeitadas — expandir/recolher
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-96 space-y-3 overflow-y-auto custom-scroll border-t px-4 py-3">
              {history.map((r) => (
                <RequestCard key={r.id} request={r} canManage={false} onActivate={() => {}} onReject={() => {}} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Confirmação de ativação de trial */}
      <AlertDialog open={!!activateTarget} onOpenChange={(open) => !open && setActivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar trial de 14 dias?</AlertDialogTitle>
            <AlertDialogDescription>
              Será criado o tenant <strong className="text-foreground">{activateTarget?.chamberName}</strong>{' '}
              (
              <code className="rounded bg-muted px-1 font-mono text-xs">{activateTarget?.slug}</code>) no
              plano profissional com trial até daqui a 14 dias, mais o usuário responsável{' '}
              <span className="font-mono text-xs">{activateTarget?.email}</span> com senha temporária.
              A ação é auditada e não pode ser desfeita por aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => activateTarget && activate.mutate(activateTarget.id)}
            >
              {activate.isPending && <RefreshCw className="animate-spin" />} Ativar trial
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resultado da ativação — senha temporária exibida UMA vez */}
      <Dialog
        open={!!activationResult}
        onOpenChange={(open) => !open && setActivationResult(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
              Trial ativado — {activationResult?.tenantName}
            </DialogTitle>
            <DialogDescription>
              Entregue as credenciais ao responsável por um canal seguro. A senha abaixo é exibida{' '}
              <strong className="text-foreground">apenas nesta vez</strong> — depois só resta a
              redefinição pela plataforma.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Login (e-mail do responsável)
                </p>
                <p className="truncate font-mono text-sm">{activationResult?.request.email}</p>
              </div>
              <CopyButton text={activationResult?.request.email ?? ''} label="E-mail" />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Senha temporária
                </p>
                <p className="truncate font-mono text-sm font-bold">
                  {activationResult?.temporaryPassword}
                </p>
              </div>
              <CopyButton text={activationResult?.temporaryPassword ?? ''} label="Senha temporária" />
            </div>
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-800 dark:text-amber-300"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Sem SMTP no sandbox a senha não sai por e-mail — copie agora e oriente a troca no
                primeiro acesso (o pedido passa a constar no histórico como “Ativada”).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setActivationResult(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejeição com nota obrigatória */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="size-5 text-rose-600 dark:text-rose-400" />
              Rejeitar pedido — {rejectTarget?.chamberName}
            </DialogTitle>
            <DialogDescription>
              A nota (5–200 caracteres) é o feedback registrado para a câmara e permanece no
              histórico do pedido. O slug continua ocupado — um novo pedido precisará de outro.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Nota da rejeição</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Ex.: município já atendido pelo sistema legado — reaplique após a migração."
              rows={4}
              maxLength={200}
              aria-describedby="reject-note-hint"
            />
            <p id="reject-note-hint" className="text-xs text-muted-foreground">
              {rejectNote.trim().length}/200 — mínimo 5 caracteres.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!noteValid || reject.isPending}
              onClick={() =>
                rejectTarget && reject.mutate({ id: rejectTarget.id, note: rejectNote.trim() })
              }
            >
              {reject.isPending && <RefreshCw className="animate-spin" />} Rejeitar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function GrowthModule() {
  const can = useApp((s) => s.can)
  const allowed = can('platform.read')
  const canManage = can('platform.manage')

  const metricsQ = useQuery({
    queryKey: ['growth', 'metrics'],
    queryFn: () => growthApi.metrics(),
    enabled: allowed,
  })

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={<TrendingUp />}
          title="Crescimento"
          description="Self-onboarding com trial de 14 dias, health score anti-churn por tenant, métricas de negócio (MRR simulado, churn, trials) e NPS consolidado (Fase 24 da Onda 5)."
          actions={<Badge variant="outline">Fase 24 · Onda 5</Badge>}
        />
        <EmptyState
          icon={<ShieldAlert />}
          title="Acesso restrito à operação da plataforma"
          description="O painel de crescimento (métricas de negócio, saúde dos tenants e fila de onboarding) exige a permissão platform.read — reservada ao dono e ao suporte da plataforma."
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        icon={<TrendingUp />}
        title="Crescimento"
        description="Self-onboarding com trial de 14 dias, health score anti-churn por tenant, métricas de negócio (MRR simulado, churn, trials) e NPS consolidado (Fase 24 da Onda 5)."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline">Fase 24 · Onda 5</Badge>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Activity className="size-3" aria-hidden />
              {canManage ? 'leitura + gestão (owner)' : 'somente leitura (suporte)'}
            </span>
          </div>
        }
      />

      {/* 1 · Métricas SaaS */}
      {metricsQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : metricsQ.data ? (
        <MetricsSection metrics={metricsQ.data} />
      ) : (
        <EmptyState
          icon={<TrendingUp />}
          title="Métricas indisponíveis"
          description="Não foi possível carregar as métricas de negócio agora — tente recarregar o módulo."
        />
      )}

      {/* 2 · Saúde por tenant */}
      <HealthSection canManage={canManage} />

      {/* 3 · Fila de onboarding */}
      <OnboardingSection canManage={canManage} />

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Landmark className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Convenções: trials não contam no MRR (só assinaturas “ativas”); churn 90d usa tenants
        desativados com atualização nos últimos 90 dias; NPS é consolidado apenas de forma agregada
        (respostas individuais nunca saem do próprio usuário). Ver ADR-025.
      </p>
    </div>
  )
}
