'use client'

/**
 * Fase 10 — Aba "Faturamento" do Console da Plataforma: ciclo comercial do
 * SaaS com KPIs (MRR, em aberto, vencidas, pagas no ano), tabela de faturas
 * (filtro por tenant/status), execução do ciclo do mês (geração + dunning),
 * registro de pagamento e cancelamento com justificativa, e métricas de uso
 * por tenant vs limites do plano (excedentes alimentam a cobrança).
 * Acesso exclusivo de platform_owner (RBAC server-side; fallback EmptyState).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Landmark,
  MoreHorizontal,
  RefreshCw,
  ReceiptText,
  Sparkles,
  TrendingUp,
  Users,
  Webhook as WebhookIcon,
} from 'lucide-react'

import { useApp } from '@/lib/store'
import { EmptyState } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// ─── Tipos locais (contrato das rotas /api/v1/platform/billing) ─────────────

type InvoiceLine = {
  description: string
  quantity: number
  unitCents: number
  totalCents: number
}

type InvoiceView = {
  id: string
  tenantId: string
  tenantName: string | null
  number: number
  numberLabel: string
  periodYear: number
  periodMonth: number
  periodLabel: string
  status: 'open' | 'paid' | 'canceled' | string
  isOverdue: boolean
  lines: InvoiceLine[]
  subtotalCents: number
  discountCents: number
  totalCents: number
  issuedAt: string
  dueAt: string
  paidAt: string | null
  paidMethod: string | null
  notes: string | null
}

type BillingSummary = {
  openCount: number
  openTotalCents: number
  overdueCount: number
  overdueTotalCents: number
  paidThisYearCount: number
  paidThisYearTotalCents: number
  mrrCents: number
}

type UsageResponse = {
  tenantId: string
  tenantName: string
  period: { year: number; month: number }
  plan: { name: string; priceCents: number } | null
  subscriptionStatus: string | null
  limits: { maxParliamentarians: number | null; maxSessionsPerMonth: number | null }
  usage: {
    sessions: number
    activeParliamentarians: number
    aiArtifacts: number
    webhookDeliveries: number
  }
  overage: { parliamentarians: number; sessions: number }
}

type TenantOption = { id: string; name: string; slug: string }

type Problem = {
  title?: string
  detail?: string
  status?: number
  code?: string
  errors?: Record<string, string[]>
}

// ─── Fetch local (api-client.ts é intocável) ────────────────────────────────

class BillingApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title || 'Erro na requisição.')
    this.name = 'BillingApiError'
  }
}

/** fetch + JSON + throw com parse do Problem Details; credenciais same-origin. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  // Coexistência com o modo demo (ADR-005): sem sessão, o header resolve o ator.
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) throw new BillingApiError((body ?? {}) as Problem)
  return body as T
}

function problemMessage(err: unknown): string {
  if (err instanceof BillingApiError) {
    const fields = err.problem.errors
      ? Object.values(err.problem.errors).flat().filter(Boolean).join(' ')
      : ''
    return [err.problem.detail, fields].filter(Boolean).join(' — ')
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

// ─── Formatação pt-BR ───────────────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCents = (cents: number) => brl.format(cents / 100)
const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'

const METHOD_LABEL: Record<string, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao: 'Cartão',
  transferencia: 'Transferência',
}

// ─── Badges de status ───────────────────────────────────────────────────────

function InvoiceStatusBadge({ invoice }: { invoice: Pick<InvoiceView, 'status' | 'isOverdue'> }) {
  if (invoice.status === 'paid') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3" /> Paga
      </Badge>
    )
  }
  if (invoice.status === 'canceled') {
    return (
      <Badge variant="secondary">
        <Ban className="size-3" /> Cancelada
      </Badge>
    )
  }
  if (invoice.isOverdue) {
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-300">
        <CalendarX2 className="size-3" /> Vencida
      </Badge>
    )
  }
  return (
    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
      <Clock3 className="size-3" /> Em aberta
    </Badge>
  )
}

// ─── Dialog de detalhe da fatura ────────────────────────────────────────────

function InvoiceDetailDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceView | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-2xl">
        {invoice && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <ReceiptText className="size-5 text-primary" />
                Fatura {invoice.numberLabel}
                <InvoiceStatusBadge invoice={invoice} />
              </DialogTitle>
              <DialogDescription>
                {invoice.tenantName ?? 'Tenant'} · competência {invoice.periodLabel} · emitida em{' '}
                {fmtDay(invoice.issuedAt)} · vencimento em {fmtDay(invoice.dueAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="px-3">Descrição</TableHead>
                      <TableHead className="px-3 text-right">Qtd.</TableHead>
                      <TableHead className="px-3 text-right">Unitário</TableHead>
                      <TableHead className="px-3 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.lines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="max-w-[260px] whitespace-normal px-3">
                          {line.description}
                        </TableCell>
                        <TableCell className="px-3 text-right tabular-nums">
                          {line.quantity}
                        </TableCell>
                        <TableCell className="px-3 text-right tabular-nums">
                          {fmtCents(line.unitCents)}
                        </TableCell>
                        <TableCell className="px-3 text-right tabular-nums font-medium">
                          {fmtCents(line.totalCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {invoice.lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                          Fatura sem linhas registradas.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <dl className="space-y-1 rounded-lg border bg-card p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{fmtCents(invoice.subtotalCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Desconto</dt>
                  <dd className="tabular-nums">−{fmtCents(invoice.discountCents)}</dd>
                </div>
                <div className="flex justify-between border-t pt-1 text-base font-bold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{fmtCents(invoice.totalCents)}</dd>
                </div>
              </dl>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {invoice.status === 'paid' && (
                  <>
                    <p className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2">
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                      Paga em {fmtDay(invoice.paidAt)} via{' '}
                      {METHOD_LABEL[invoice.paidMethod ?? ''] ?? invoice.paidMethod}
                    </p>
                  </>
                )}
                {invoice.status === 'canceled' && (
                  <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 sm:col-span-2">
                    <Ban className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <strong>Cancelada.</strong> {invoice.notes ?? 'Sem justificativa registrada.'}
                    </span>
                  </p>
                )}
                {invoice.status === 'open' && (
                  <p className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 sm:col-span-2">
                    <Clock3 className="size-4 text-amber-600 dark:text-amber-400" />
                    {invoice.isOverdue
                      ? `Vencida desde ${fmtDay(invoice.dueAt)} — sujeita a dunning (assinatura past_due).`
                      : `Aguardando pagamento até ${fmtDay(invoice.dueAt)}.`}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog de pagamento ────────────────────────────────────────────────────

function PayDialog({
  invoice,
  onClose,
  onPaid,
}: {
  invoice: InvoiceView | null
  onClose: () => void
  onPaid: () => void
}) {
  const [method, setMethod] = useState('pix')
  const pay = useMutation({
    mutationFn: (v: { id: string; method: string }) =>
      apiFetch<{ invoice: InvoiceView }>(`/api/v1/platform/billing/invoices/${v.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method: v.method }),
      }),
    onSuccess: (r) => {
      toast.success('Pagamento registrado', {
        description: `Fatura ${r.invoice.numberLabel} de ${r.invoice.tenantName ?? '—'} marcada como paga (${fmtCents(r.invoice.totalCents)}).`,
      })
      onClose()
      onPaid()
    },
    onError: (err) => {
      toast.error('Falha ao registrar pagamento', { description: problemMessage(err) })
    },
  })

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-5 text-primary" /> Registrar pagamento
          </DialogTitle>
          <DialogDescription>
            Fatura {invoice?.numberLabel} · {invoice?.tenantName ?? '—'} ·{' '}
            {invoice ? fmtCents(invoice.totalCents) : ''} — informe o meio de pagamento.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pay-method">Método de pagamento</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="pay-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pix">Pix</SelectItem>
              <SelectItem value="boleto">Boleto</SelectItem>
              <SelectItem value="cartao">Cartão</SelectItem>
              <SelectItem value="transferencia">Transferência</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={pay.isPending} onClick={() => invoice && pay.mutate({ id: invoice.id, method })}>
            {pay.isPending && <RefreshCw className="animate-spin" />}
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Confirmação de cancelamento ────────────────────────────────────────────

function CancelDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceView | null
  onClose: () => void
  onDone: () => void
}) {
  const [justification, setJustification] = useState('')
  // Reset derivado no render quando o alvo muda (sem setState em effect).
  const [prevTargetId, setPrevTargetId] = useState(invoice?.id ?? null)
  if (prevTargetId !== (invoice?.id ?? null)) {
    setPrevTargetId(invoice?.id ?? null)
    setJustification('')
  }

  const cancel = useMutation({
    mutationFn: (v: { id: string; justification: string }) =>
      apiFetch<{ invoice: InvoiceView }>(`/api/v1/platform/billing/invoices/${v.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ justification: v.justification }),
      }),
    onSuccess: (r) => {
      toast.success('Fatura cancelada', {
        description: `Fatura ${r.invoice.numberLabel} cancelada com justificativa auditada.`,
      })
      onClose()
      onDone()
    },
    onError: (err) => {
      toast.error('Falha ao cancelar fatura', { description: problemMessage(err) })
    },
  })

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-5 text-destructive" /> Cancelar fatura {invoice?.numberLabel}?
          </DialogTitle>
          <DialogDescription>
            A fatura de {invoice?.tenantName ?? '—'} ({invoice ? fmtCents(invoice.totalCents) : ''})
            será cancelada e a justificativa gravada na auditoria do tenant. A ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-justification">
            Justificativa (obrigatória, mín. 10 caracteres)
          </Label>
          <Textarea
            id="cancel-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Ex.: Emissão duplicada por reprocessamento do ciclo — ajuste manual da operação."
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Manter fatura
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending || justification.trim().length < 10}
            onClick={() => invoice && cancel.mutate({ id: invoice.id, justification: justification.trim() })}
          >
            {cancel.isPending && <RefreshCw className="animate-spin" />}
            Cancelar fatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Seção de uso por tenant ────────────────────────────────────────────────

function UsageCard({
  icon,
  title,
  value,
  suffix,
  limit,
  overage,
  overageHint,
}: {
  icon: React.ReactNode
  title: string
  value: number
  suffix?: string
  limit: number | null
  overage: number
  overageHint: string
}) {
  const pct = limit !== null ? Math.min(100, Math.round((value / limit) * 100)) : 0
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-xs font-medium uppercase tracking-wide">{title}</p>
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums">
        {value}
        {suffix && <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>}
      </p>
      {limit !== null ? (
        <div className="mt-2 space-y-1">
          <Progress value={pct} aria-label={`${title}: ${value} de ${limit}`} />
          <p className="text-xs text-muted-foreground">
            {value} de {limit} ({pct}%)
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Sem limite contratado (ilimitado)</p>
      )}
      {overage > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          +{overage} {overageHint}
        </p>
      )}
    </div>
  )
}

// ─── Aba de faturamento ─────────────────────────────────────────────────────

export default function BillingTab({ tenants: tenantsProp }: { tenants?: TenantOption[] }) {
  const canManage = useApp((s) => s.can('platform.manage'))
  const qc = useQueryClient()

  const [tenantFilter, setTenantFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [detailInvoice, setDetailInvoice] = useState<InvoiceView | null>(null)
  const [payTarget, setPayTarget] = useState<InvoiceView | null>(null)
  const [cancelTarget, setCancelTarget] = useState<InvoiceView | null>(null)
  const [cycleOpen, setCycleOpen] = useState(false)
  const [usageTenantIdRaw, setUsageTenantId] = useState('')

  // Lista de tenants para os filtros (o console pode injetar; senão busca).
  const tenantsQuery = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => apiFetch<{ tenants: TenantOption[] }>('/api/v1/platform/tenants'),
    enabled: canManage && !tenantsProp,
  })
  const tenants = tenantsProp ?? tenantsQuery.data?.tenants ?? []
  // Pré-seleciona o primeiro tenant na seção de uso (derivado no render).
  const usageTenantId = usageTenantIdRaw || tenants[0]?.id || ''

  const invoicesQuery = useQuery({
    queryKey: ['billing-invoices', tenantFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (tenantFilter !== 'all') params.set('tenant', tenantFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const qs = params.toString()
      return apiFetch<{ invoices: InvoiceView[]; summary: BillingSummary }>(
        `/api/v1/platform/billing/invoices${qs ? `?${qs}` : ''}`
      )
    },
    enabled: canManage,
  })

  const usageQuery = useQuery({
    queryKey: ['billing-usage', usageTenantId],
    queryFn: () => apiFetch<UsageResponse>(`/api/v1/platform/tenants/${usageTenantId}/usage`),
    enabled: canManage && !!usageTenantId,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['billing-invoices'] })
  }

  const runCycle = useMutation({
    mutationFn: () =>
      apiFetch<{ generated: number; skipped: number; dunning: number }>(
        '/api/v1/platform/billing/cycle',
        { method: 'POST', body: JSON.stringify({}) }
      ),
    onSuccess: (r) => {
      toast.success('Ciclo do mês executado', {
        description: `${r.generated} fatura(s) gerada(s) · ${r.skipped} ignorada(s) · ${r.dunning} em dunning.`,
      })
      setCycleOpen(false)
      invalidate()
      void qc.invalidateQueries({ queryKey: ['platform-tenants'] })
    },
    onError: (err) => {
      toast.error('Falha ao executar o ciclo', { description: problemMessage(err) })
    },
  })

  if (!canManage) {
    return (
      <EmptyState
        icon={<ReceiptText className="size-8" />}
        title="Acesso exclusivo da operação da plataforma"
        description="O faturamento do SaaS é restrito ao papel Operação da Plataforma (platform_owner)."
      />
    )
  }

  const summary = invoicesQuery.data?.summary
  const invoices = invoicesQuery.data?.invoices ?? []
  const usage = usageQuery.data

  return (
    <div className="space-y-6">
      {/* KPIs do ciclo comercial */}
      <section aria-label="Indicadores de faturamento" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="size-4" />
            <p className="text-xs font-medium uppercase tracking-wide">MRR</p>
          </div>
          {summary ? (
            <>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{fmtCents(summary.mrrCents)}</p>
              <p className="text-xs text-muted-foreground">assinaturas active/past_due (trial à parte)</p>
            </>
          ) : (
            <Skeleton className="mt-2 h-8 w-24" />
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="size-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Em aberto</p>
          </div>
          {summary ? (
            <>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{fmtCents(summary.openTotalCents)}</p>
              <p className="text-xs text-muted-foreground">
                {summary.openCount} fatura(s) aguardando pagamento
              </p>
            </>
          ) : (
            <Skeleton className="mt-2 h-8 w-24" />
          )}
        </div>
        <div
          className={cn(
            'rounded-xl border bg-card p-4',
            (summary?.overdueCount ?? 0) > 0 && 'border-red-300 bg-red-500/5 dark:border-red-800'
          )}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarX2 className="size-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Vencidas</p>
          </div>
          {summary ? (
            <>
              <p
                className={cn(
                  'mt-1.5 flex items-center gap-2 text-2xl font-bold tabular-nums',
                  summary.overdueCount > 0 && 'text-red-600 dark:text-red-400'
                )}
              >
                {fmtCents(summary.overdueTotalCents)}
                {summary.overdueCount > 0 && (
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-300">
                    {summary.overdueCount}
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">dunning marca a assinatura como past_due</p>
            </>
          ) : (
            <Skeleton className="mt-2 h-8 w-24" />
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CircleDollarSign className="size-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Pagas no ano</p>
          </div>
          {summary ? (
            <>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">
                {fmtCents(summary.paidThisYearTotalCents)}
              </p>
              <p className="text-xs text-muted-foreground">{summary.paidThisYearCount} fatura(s) quitadas</p>
            </>
          ) : (
            <Skeleton className="mt-2 h-8 w-24" />
          )}
        </div>
      </section>

      {/* Faturas */}
      <section aria-label="Faturas" className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 className="mr-auto text-sm font-semibold">Faturas</h2>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-56" aria-label="Filtrar faturas por tenant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tenants</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.slug}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Filtrar faturas por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="open">Abertas</SelectItem>
              <SelectItem value="overdue">Vencidas</SelectItem>
              <SelectItem value="paid">Pagas</SelectItem>
              <SelectItem value="canceled">Canceladas</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCycleOpen(true)}>
            <RefreshCw className={cn(runCycle.isPending && 'animate-spin')} />
            Executar ciclo do mês
          </Button>
        </div>

        {invoicesQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : invoicesQuery.isError ? (
          <div className="p-6">
            <EmptyState
              icon={<AlertTriangle className="size-7" />}
              title="Não foi possível carregar as faturas"
              description={problemMessage(invoicesQuery.error)}
              action={
                <Button variant="outline" onClick={() => void invoicesQuery.refetch()}>
                  <RefreshCw /> Tentar novamente
                </Button>
              }
            />
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ReceiptText className="size-7" />}
              title="Nenhuma fatura no filtro atual"
              description="Execute o ciclo do mês para emitir as faturas de competência (mensalidade + excedentes de uso) de todos os tenants ativos."
            />
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto custom-scroll">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="px-4">Nº</TableHead>
                  <TableHead className="px-4">Tenant</TableHead>
                  <TableHead className="px-4">Competência</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4 text-right">Total</TableHead>
                  <TableHead className="px-4">Vencimento</TableHead>
                  <TableHead className="px-4">Método</TableHead>
                  <TableHead className="px-4 text-right sr-only">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => setDetailInvoice(inv)}
                    aria-label={`Abrir detalhes da fatura ${inv.numberLabel}`}
                  >
                    <TableCell className="px-4 font-mono text-xs font-semibold">
                      {inv.numberLabel}
                    </TableCell>
                    <TableCell className="max-w-52 truncate px-4">{inv.tenantName ?? inv.tenantId}</TableCell>
                    <TableCell className="px-4 tabular-nums">{inv.periodLabel}</TableCell>
                    <TableCell className="px-4">
                      <InvoiceStatusBadge invoice={inv} />
                    </TableCell>
                    <TableCell className="px-4 text-right font-medium tabular-nums">
                      {fmtCents(inv.totalCents)}
                    </TableCell>
                    <TableCell className="px-4 tabular-nums">{fmtDay(inv.dueAt)}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {inv.status === 'paid'
                        ? (METHOD_LABEL[inv.paidMethod ?? ''] ?? inv.paidMethod ?? '—')
                        : '—'}
                    </TableCell>
                    <TableCell className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {inv.status === 'open' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Ações da fatura ${inv.numberLabel}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPayTarget(inv)}>
                              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                              Registrar pagamento
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setCancelTarget(inv)}
                            >
                              <Ban className="size-4" /> Cancelar fatura
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Uso por tenant vs limites do plano */}
      <section aria-label="Uso por tenant" className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 className="mr-auto text-sm font-semibold">Uso por tenant (competência corrente)</h2>
          <Select
            value={usageTenantId || 'none'}
            onValueChange={(v) => setUsageTenantId(v === 'none' ? '' : v)}
          >
            <SelectTrigger className="w-56" aria-label="Selecionar tenant para métricas de uso">
              <SelectValue placeholder="Selecione o tenant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Selecione o tenant</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {usageTenantId === '' ? (
          <div className="p-6">
            <EmptyState
              icon={<Landmark className="size-7" />}
              title="Selecione um tenant"
              description="Escolha uma Câmara para comparar o uso do mês corrente com os limites do plano contratado."
            />
          </div>
        ) : usageQuery.isLoading ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : usageQuery.isError ? (
          <div className="p-6">
            <EmptyState
              icon={<AlertTriangle className="size-7" />}
              title="Não foi possível carregar o uso"
              description={problemMessage(usageQuery.error)}
              action={
                <Button variant="outline" onClick={() => void usageQuery.refetch()}>
                  <RefreshCw /> Tentar novamente
                </Button>
              }
            />
          </div>
        ) : usage ? (
          <div className="space-y-4 p-4">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Landmark className="size-3.5" />
              {usage.tenantName} · competência{' '}
              {String(usage.period.month).padStart(2, '0')}/{usage.period.year}
              {usage.plan && (
                <>
                  {' '}· plano <strong className="text-foreground capitalize">{usage.plan.name}</strong>{' '}
                  ({fmtCents(usage.plan.priceCents)}/mês)
                </>
              )}
              {usage.subscriptionStatus && (
                <Badge variant="outline" className="capitalize">{usage.subscriptionStatus}</Badge>
              )}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <UsageCard
                icon={<Users className="size-4" />}
                title="Parlamentares ativos"
                value={usage.usage.activeParliamentarians}
                limit={usage.limits.maxParliamentarians}
                overage={usage.overage.parliamentarians}
                overageHint="acima do limite — R$ 25,00/parlamentar excedente na fatura"
              />
              <UsageCard
                icon={<CalendarDays className="size-4" />}
                title="Sessões no mês"
                value={usage.usage.sessions}
                limit={usage.limits.maxSessionsPerMonth}
                overage={usage.overage.sessions}
                overageHint="acima do limite — R$ 40,00/sessão excedente na fatura"
              />
              <UsageCard
                icon={<Sparkles className="size-4" />}
                title="Artefatos de IA"
                value={usage.usage.aiArtifacts}
                limit={null}
                overage={0}
                overageHint=""
              />
              <UsageCard
                icon={<WebhookIcon className="size-4" />}
                title="Entregas de webhook"
                value={usage.usage.webhookDeliveries}
                limit={null}
                overage={0}
                overageHint=""
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* Diálogos */}
      <InvoiceDetailDialog invoice={detailInvoice} onClose={() => setDetailInvoice(null)} />
      <PayDialog
        invoice={payTarget}
        onClose={() => setPayTarget(null)}
        onPaid={invalidate}
      />
      <CancelDialog
        invoice={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={invalidate}
      />

      <AlertDialog open={cycleOpen} onOpenChange={setCycleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-5 text-primary" /> Executar o ciclo de faturamento do mês?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Serão emitidas as faturas da competência do mês corrente para todas as Câmaras ativas
              com assinatura (mensalidade do plano + excedentes de parlamentares a R$ 25,00/un e de
              sessões a R$ 40,00/un, com vencimento em 10 dias). Tenants que já possuem fatura do
              mês são ignorados. Em seguida o dunning marca como <strong>past_due</strong> as
              assinaturas com faturas abertas vencidas e notifica os administradores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={runCycle.isPending} onClick={(e) => { e.preventDefault(); runCycle.mutate() }}>
              {runCycle.isPending && <RefreshCw className="animate-spin" />}
              Executar ciclo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
