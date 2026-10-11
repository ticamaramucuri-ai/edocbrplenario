'use client'

/**
 * Módulo Webhooks (Fase 6) — endpoints de integração com assinatura HMAC:
 * lista de endpoints (url, eventos em badges, ativo switch, segredo mascarado
 * com revelar/copiar), dialog criar/editar com checkboxes da allowlist,
 * entregas por endpoint (Sheet com status/tentativas/erro/responseStatus,
 * filtro por status, badge dead), botões Testar/Reprocessar (com confirmação)
 * e contador de entregas mortas em destaque.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCheck,
  Copy,
  Eye,
  EyeOff,
  Send,
  Skull,
  Webhook as WebhookIcon,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  Zap,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import {
  DELIVERY_STATUS_LABEL,
  WEBHOOK_EVENT_LABEL,
  type WebhookDeliveryView,
  type WebhookEndpointView,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; webhook: WebhookEndpointView }
  | null

function DeliveryStatusBadge({ status }: { status: WebhookDeliveryView['status'] }) {
  const map: Record<WebhookDeliveryView['status'], string> = {
    pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    failed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    dead: 'bg-rose-600 text-white',
  }
  const icons: Record<WebhookDeliveryView['status'], React.ReactNode> = {
    pending: <RefreshCw className="size-3" />,
    success: <CheckCheck className="size-3" />,
    failed: <AlertTriangle className="size-3" />,
    dead: <Skull className="size-3" />,
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', map[status])}>
      {icons[status]} {DELIVERY_STATUS_LABEL[status]}
    </span>
  )
}

/** Dialog criar/editar endpoint (url + checkboxes de eventos da allowlist). */
function WebhookDialog({
  state,
  allowedEvents,
  onClose,
}: {
  state: Extract<DialogState, { mode: 'create' | 'edit' }>
  allowedEvents: string[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const editing = state.mode === 'edit' ? state.webhook : null
  const [url, setUrl] = useState(editing?.url ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [events, setEvents] = useState<string[]>(editing?.events ?? ['test.ping'])

  const toggleEvent = (ev: string, checked: boolean) =>
    setEvents((prev) => (checked ? [...new Set([...prev, ev])] : prev.filter((e) => e !== ev)))

  const save = useMutation({
    mutationFn: async () => {
      if (editing) return api.updateWebhook(editing.id, { url, events, description: description || null })
      return api.createWebhook({ url, events, description: description || null })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success(editing ? 'Webhook atualizado' : 'Webhook criado', {
        description: `${events.length} evento(s) inscrito(s). Segredo HMAC gerado para assinatura das entregas.`,
      })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WebhookIcon className="size-5 text-primary" /> {editing ? 'Editar webhook' : 'Novo webhook'}
          </DialogTitle>
          <DialogDescription>
            As entregas são assinadas com HMAC-SHA256 (header <code className="rounded bg-muted px-1 text-[11px]">x-legis-signature</code>)
            e reenviadas com backoff até 5 tentativas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">URL de destino (http/https)</Label>
            <Input
              id="wh-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://meu-sistema.exemplo/webhooks/legis"
            />
            <p className="text-xs text-muted-foreground">
              Para demonstração local sem internet: <code className="rounded bg-muted px-1">http://localhost:3000/api/v1/webhooks/echo</code> (endpoint de eco).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-desc">Descrição (opcional)</Label>
            <Input
              id="wh-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Integração com o site oficial da Câmara"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Eventos inscritos</legend>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto custom-scroll rounded-md border p-3 sm:grid-cols-2">
              {allowedEvents.map((ev) => (
                <label key={ev} className="flex cursor-pointer items-start gap-2 text-sm" htmlFor={`ev-${ev}`}>
                  <Checkbox
                    id={`ev-${ev}`}
                    checked={events.includes(ev)}
                    onCheckedChange={(c) => toggleEvent(ev, c === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block leading-tight">{WEBHOOK_EVENT_LABEL[ev] ?? ev}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">{ev}</span>
                  </span>
                </label>
              ))}
            </div>
            {events.length === 0 && (
              <p className="text-xs font-medium text-destructive">Selecione ao menos 1 evento.</p>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || events.length === 0 || url.trim().length < 8}
          >
            {save.isPending && <RefreshCw className="animate-spin" />}
            {editing ? 'Salvar alterações' : 'Criar webhook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Sheet de entregas do endpoint com filtro por status e ações de replay. */
function DeliveriesSheet({
  webhook,
  onClose,
}: {
  webhook: WebhookEndpointView
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [replayTarget, setReplayTarget] = useState<WebhookDeliveryView | null>(null)

  const deliveriesQ = useQuery({
    queryKey: ['webhook-deliveries', webhook.id, statusFilter],
    queryFn: () =>
      api.listWebhookDeliveries(webhook.id, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
      }),
    refetchInterval: 5000,
  })

  const replay = useMutation({
    mutationFn: (deliveryId: string) => api.replayWebhookDelivery(deliveryId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhook-deliveries', webhook.id] })
      toast.success('Entrega reprocessada', {
        description: 'Nova entrega pending criada com o mesmo payload — o serviço (porta 3004) vai reenviá-la.',
      })
      setReplayTarget(null)
    },
  })

  const deliveries = deliveriesQ.data?.deliveries ?? []
  const counts = deliveriesQ.data?.counts ?? {}

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto custom-scroll sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-6">
            <Send className="size-5 text-primary" /> Entregas
            {webhook.deadCount > 0 && (
              <Badge className="bg-rose-600 text-white">
                <Skull className="size-3" /> {webhook.deadCount} morta(s)
              </Badge>
            )}
          </SheetTitle>
          <p className="truncate text-xs text-muted-foreground">{webhook.url}</p>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44" aria-label="Filtrar entregas por status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="success">Entregues</SelectItem>
                <SelectItem value="failed">Falhas</SelectItem>
                <SelectItem value="dead">Mortas</SelectItem>
              </SelectContent>
            </Select>
            {Object.keys(counts).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {counts.pending ?? 0} pendente(s) · {counts.success ?? 0} entregue(s) · {counts.failed ?? 0} falha(s) ·{' '}
                {counts.dead ?? 0} morta(s)
              </p>
            )}
          </div>

          {deliveriesQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : deliveries.length === 0 ? (
            <EmptyState
              icon={<Send />}
              title="Nenhuma entrega"
              description="Use o botão Testar para disparar uma entrega de demonstração (test.ping)."
            />
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto custom-scroll pr-1">
              {deliveries.map((d) => (
                <div key={d.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{d.eventType}</span>
                    <DeliveryStatusBadge status={d.status} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      Tentativas: <strong className="text-foreground">{d.attempts}/5</strong>
                    </span>
                    {d.responseStatus !== null && (
                      <span>
                        HTTP: <strong className="text-foreground">{d.responseStatus}</strong>
                      </span>
                    )}
                    <span>Criada: {fmtDateTime(d.createdAt)}</span>
                    {d.deliveredAt && <span>Entregue: {fmtDateTime(d.deliveredAt)}</span>}
                    {d.nextAttemptAt && <span>Próxima tentativa: {fmtDateTime(d.nextAttemptAt)}</span>}
                  </div>
                  {d.lastError && (
                    <p className="mt-1.5 break-all rounded bg-rose-500/10 px-2 py-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">
                      {d.lastError}
                    </p>
                  )}
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReplayTarget(d)}
                      disabled={d.status === 'pending'}
                    >
                      <RotateCcw className="size-3.5" /> Reprocessar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <AlertDialog open={!!replayTarget} onOpenChange={(open) => !open && setReplayTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reprocessar entrega?</AlertDialogTitle>
              <AlertDialogDescription>
                Uma nova entrega <strong>pending</strong> será criada com o mesmo payload do evento{' '}
                <code className="rounded bg-muted px-1">{replayTarget?.eventType}</code> e enviada pelo serviço de
                webhooks.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => replayTarget && replay.mutate(replayTarget.id)}>
                Reprocessar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}

function SecretReveal({ masked }: { masked: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      <code className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]', !revealed && 'select-none blur-[3px]')}>
        {masked}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? 'Ocultar segredo' : 'Revelar segredo'}
      >
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={() => {
          void navigator.clipboard.writeText(masked).then(() => toast.success('Segredo copiado'))
        }}
        aria-label="Copiar segredo"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  )
}

export default function WebhooksModule() {
  const qc = useQueryClient()
  const canManage = useApp((s) => s.can('webhook.manage'))
  const [dialog, setDialog] = useState<DialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpointView | null>(null)
  const [deliveriesTarget, setDeliveriesTarget] = useState<WebhookEndpointView | null>(null)

  const webhooksQ = useQuery({ queryKey: ['webhooks'], queryFn: () => api.listWebhooks() })
  const webhooks = webhooksQ.data?.webhooks ?? []
  const allowedEvents = webhooksQ.data?.allowedEvents ?? []
  const totalDead = webhooks.reduce((acc, w) => acc + w.deadCount, 0)

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateWebhook(id, { active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  const test = useMutation({
    mutationFn: (id: string) => api.testWebhook(id),
    onSuccess: () => {
      toast.success('Teste disparado', {
        description: 'Entrega test.ping criada — o serviço de webhooks enviará em até 1s.',
      })
      if (deliveriesTarget) void qc.invalidateQueries({ queryKey: ['webhook-deliveries', deliveriesTarget.id] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook excluído')
      setDeleteTarget(null)
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Integrações externas com assinatura HMAC-SHA256, retentativas com backoff e dead-letter notificado."
        icon={<WebhookIcon />}
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <Zap /> Novo webhook
            </Button>
          ) : undefined
        }
      />

      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Endpoints</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{webhooks.length}</p>
          <p className="text-xs text-muted-foreground">
            {webhooks.filter((w) => w.active).length} ativo(s) · {webhooks.filter((w) => !w.active).length} inativo(s)
          </p>
        </div>
        <div className={cn('rounded-xl border p-4', totalDead > 0 && 'border-rose-300 bg-rose-500/5 dark:border-rose-800')}>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Skull className="size-3.5" /> Entregas mortas
          </p>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', totalDead > 0 && 'text-rose-600 dark:text-rose-400')}>
            {totalDead}
          </p>
          <p className="text-xs text-muted-foreground">dead-letter após 5 tentativas</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assinatura</p>
          <p className="mt-1 font-mono text-xs font-semibold">x-legis-signature</p>
          <p className="text-xs text-muted-foreground">HMAC-SHA256 do corpo + timestamp anti-replay</p>
        </div>
      </div>

      {/* Lista de endpoints */}
      {webhooksQ.isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={<WebhookIcon />}
          title="Nenhum webhook cadastrado"
          description={
            canManage
              ? 'Cadastre um endpoint para receber eventos legislativos (sessões, votações, tramitação) em tempo real.'
              : 'O administrador da Câmara cadastra endpoints de integração aqui.'
          }
          action={
            canManage ? (
              <Button onClick={() => setDialog({ mode: 'create' })}>
                <Zap /> Novo webhook
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {webhooks.map((w) => (
            <article key={w.id} className="rounded-xl border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="truncate rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                      {w.url}
                    </code>
                    {w.deadCount > 0 && (
                      <Badge className="bg-rose-600 text-white">
                        <Skull className="size-3" /> {w.deadCount} morta(s)
                      </Badge>
                    )}
                    {!w.active && <Badge variant="outline">Inativo</Badge>}
                  </div>
                  {w.description && <p className="text-sm text-muted-foreground">{w.description}</p>}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {w.events.map((ev) => (
                      <Badge key={ev} variant="secondary" className="font-mono text-[10px]">
                        {WEBHOOK_EVENT_LABEL[ev] ?? ev}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                    <span>Criado em {fmtDateTime(w.createdAt)}</span>
                    <span className="inline-flex items-center gap-1">
                      Segredo: <SecretReveal masked={w.secretMasked} />
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <label className="flex items-center gap-2 text-xs font-medium" htmlFor={`active-${w.id}`}>
                    <Switch
                      id={`active-${w.id}`}
                      checked={w.active}
                      disabled={!canManage || toggleActive.isPending}
                      onCheckedChange={(checked) => toggleActive.mutate({ id: w.id, active: checked })}
                    />
                    {w.active ? 'Ativo' : 'Inativo'}
                  </label>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setDeliveriesTarget(w)}>
                      <Send className="size-3.5" /> Entregas
                    </Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => test.mutate(w.id)} disabled={test.isPending}>
                          <Zap className="size-3.5" /> Testar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'edit', webhook: w })}>
                          <Settings2 className="size-3.5" /> Editar
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(w)}>
                          <Trash2 className="size-3.5" /> Excluir
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Dialog criar/editar */}
      {dialog && <WebhookDialog state={dialog} allowedEvents={allowedEvents} onClose={() => setDialog(null)} />}

      {/* Sheet de entregas */}
      {deliveriesTarget && (
        <DeliveriesSheet webhook={deliveriesTarget} onClose={() => setDeliveriesTarget(null)} />
      )}

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              O endpoint <code className="rounded bg-muted px-1">{deleteTarget?.url}</code> será excluído
              definitivamente junto com o histórico de entregas. A ação é auditada e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
