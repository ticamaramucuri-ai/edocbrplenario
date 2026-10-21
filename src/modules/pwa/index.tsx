'use client'

/**
 * App do Parlamentar (Fase 7 — PWA mobile-first; Fase 18/Onda 4: opções
 * regimentais customizadas nos botões de voto, hint de recibo verificável
 * pendente e lista “Meus recibos” no histórico).
 * Layout "celular" centralizado no desktop (max-w-md) e coluna única no
 * mobile. Cartões grandes: sessão atual (status/quórum/presidente + auto
 * check-in quando permitido), votação aberta (opções da votação ou
 * Sim/Não/Abstenção com confirmação e alteração conforme política), fila de
 * oradores e histórico pessoal. Status de conexão em tempo real sempre
 * visível; invalidação por eventos realtime (session.quorum,
 * voting.state_changed, vote.recorded…).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  History,
  Landmark,
  Mic,
  PenLine,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Vote,
} from 'lucide-react'

import { api, signaturesApi, type MeContextViewExt, type MyVoteReceiptRow } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { useRealtime } from '@/hooks/use-realtime'
import { fmtDateShort, fmtDateTime } from '@/lib/format'
import {
  ROLE_LABEL,
  SESSION_STATUS_LABEL,
  SPEECH_KIND_LABEL,
  VOTING_MODE_LABEL,
  type SessionStatus,
  type VoteValue,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import {
  ConnectionBadge,
  PresenceBadge,
  QuorumBadge,
  SessionStatusBadge,
  VoteValueBadge,
  VotingModeBadge,
} from '@/components/app/badges'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const LIVE_SESSION_STATUSES: SessionStatus[] = ['check_in', 'open', 'suspended', 'resumed']
type SpeechKind =
  | 'grande_expediente'
  | 'explicacoes_pessoais'
  | 'consideracoes_finais'
  | 'homenagem'
  | 'ordem'
const SPEECH_KINDS = Object.keys(SPEECH_KIND_LABEL) as SpeechKind[]

// ─── Cartão: sessão atual + auto check-in ───────────────────────────────────

function SessionCard({
  context,
  onCheckIn,
  checkingIn,
}: {
  context: MeContextViewExt
  onCheckIn: () => void
  checkingIn: boolean
}) {
  const session = context.session
  const attendance = context.attendance
  const settings = context.tenantSettings

  const sessionLive = !!session && LIVE_SESSION_STATUSES.includes(session.status)
  const selfCheckAllowed = settings.allowSelfCheckIn !== false
  const alreadyPresent = attendance?.present ?? false
  const canCheckIn = sessionLive && selfCheckAllowed && !alreadyPresent

  const reason = !session
    ? 'Nenhuma sessão agendada ou em andamento.'
    : !sessionLive
      ? `Sessão ${SESSION_STATUS_LABEL[session.status].toLowerCase()} — o check-in abre no credenciamento.`
      : !selfCheckAllowed
        ? 'Auto check-in desabilitado pelo administrador da Câmara.'
        : alreadyPresent
          ? 'Sua presença já está registrada nesta sessão.'
          : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4 text-primary" aria-hidden /> Sessão atual
          </CardTitle>
          {session && <SessionStatusBadge status={session.status} />}
        </div>
        <CardDescription>
          {session
            ? `${session.label} · ${fmtDateTime(session.scheduledAt)} · ${session.location}`
            : 'Sem sessão no momento.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {session ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <QuorumBadge present={session.quorum.present} required={session.quorum.required} ok={session.quorum.ok} />
            <span>
              Presidente: <strong className="text-foreground">{session.presidentName ?? '—'}</strong>
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Minha presença:</span>
          {attendance ? (
            <PresenceBadge status={attendance.status} />
          ) : (
            <Badge variant="outline" className="text-muted-foreground">—</Badge>
          )}
        </div>

        <Button
          size="lg"
          className="h-14 w-full text-base font-bold"
          disabled={!canCheckIn || checkingIn}
          onClick={onCheckIn}
          aria-label="Registrar minha presença na sessão atual"
        >
          <UserCheck className="size-5" aria-hidden />
          {checkingIn ? 'Registrando…' : alreadyPresent ? 'Presença registrada' : 'Registrar presença'}
        </Button>
        {reason && <p className="text-center text-xs text-muted-foreground">{reason}</p>}
      </CardContent>
    </Card>
  )
}

// ─── F22: cartão “Assinar ata da sessão encerrada” ─────────────────────

/**
 * Correção E2E v0.13.0: o alvo do cartão é a ÚLTIMA SESSÃO ENCERRADA do
 * tenant — mesma semântica do servidor em POST /me/ata/sign ("parlamentar
 * assina a ata da última sessão encerrada"), NÃO a sessão-alvo do contexto
 * (targetSessionForTenant prioriza sessões futuras agendadas e deixaria o
 * cartão inalcançável no demo). Aparece com ata publicada e parlamentar
 * ELEGÍVEL (presença registrada). Pendente → botão “Assinar ata”
 * (signaturesApi.signAta — idempotente no servidor); já assinado → badge
 * “Ata assinada” + código verificável (ADR-023).
 */
function SignAtaCard({ context }: { context: MeContextViewExt }) {
  const queryClient = useQueryClient()

  // Última sessão ENCERRADA (/sessions ordena por scheduledAt desc).
  const closedQ = useQuery({
    queryKey: ['me-ata-closed-session'],
    queryFn: () => api.listSessions(),
    staleTime: 30_000,
    retry: 1,
  })
  const target = (closedQ.data?.sessions ?? []).find((s) => s.status === 'closed') ?? null

  const panelQ = useQuery({
    queryKey: ['me-ata-signatures', target?.id],
    queryFn: () => signaturesApi.ataPanel(target!.id),
    enabled: !!target,
    retry: false,
  })
  const panel = panelQ.data ?? null
  const mine = panel?.eligible.find((e) => e.parliamentarianId === context.parliamentarian.id) ?? null
  const showCard = !!panel && panel.published && !!mine

  const sign = useMutation({
    mutationFn: () => signaturesApi.signAta(),
    onSuccess: (res) => {
      toast.success('Ata assinada eletronicamente', {
        description: `Código da sua assinatura: ${res.signature.signatureCode} — apresente-o para verificação pública de autenticidade.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['me-ata-signatures'] })
    },
  })

  if (!showCard) return null

  return (
    <Card className={mine?.signed ? 'border-emerald-500/40' : 'border-primary/40'}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="size-4 text-primary" aria-hidden />
            Assinar ata da sessão de {target ? fmtDateShort(target.scheduledAt) : '—'}
          </CardTitle>
          {mine?.signed ? (
            <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3" aria-hidden /> Ata assinada
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>
          )}
        </div>
        <CardDescription>
          {panel!.sessionLabel} — ata publicada no diário eletrônico. A assinatura eletrônica
          atesta sua PRESENÇA na sessão (cadeia de hash verificável — o voto secreto permanece
          sigiloso).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mine?.signed ? (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3">
            <p className="text-sm font-medium">Assinatura registrada</p>
            <p className="font-mono text-sm font-semibold tracking-wider">
              {mine.signatureCode}
            </p>
            <p className="text-xs text-muted-foreground">
              {mine.signedAt ? fmtDateTime(mine.signedAt) : ''} · código verificável no Portal
              Público
            </p>
          </div>
        ) : (
          <Button
            size="lg"
            className="h-14 w-full text-base font-bold"
            disabled={sign.isPending}
            onClick={() => sign.mutate()}
            aria-label="Assinar eletronicamente a ata desta sessão"
          >
            {sign.isPending ? <ReceiptText className="size-5 animate-pulse" /> : <PenLine className="size-5" />}
            {sign.isPending ? 'Assinando…' : 'Assinar ata'}
          </Button>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
          Assinatura idempotente (um clique, uma linha na cadeia) — presença confirmada pelo
          credenciamento da sessão.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Cartão: votação aberta ─────────────────────────────────────────────────

const VOTE_OPTIONS: Array<{ value: VoteValue; label: string; className: string }> = [
  { value: 'sim', label: 'Sim', className: 'bg-emerald-700 text-white hover:bg-emerald-800' },
  { value: 'nao', label: 'Não', className: 'bg-rose-600 text-white hover:bg-rose-700' },
  { value: 'abstencao', label: 'Abstenção', className: 'bg-amber-700 text-white hover:bg-amber-800' },
]

/** Fase 18 — tons alternados para opções regimentais customizadas (4º/5º repetem). */
const CUSTOM_VOTE_TONES = [
  'bg-emerald-700 text-white hover:bg-emerald-800',
  'bg-rose-600 text-white hover:bg-rose-700',
  'bg-amber-700 text-white hover:bg-amber-800',
  'bg-zinc-700 text-white hover:bg-zinc-800',
  'bg-primary text-white hover:bg-primary',
]

function votingButtons(voting: MeContextViewExt['activeVoting'] extends null ? never : NonNullable<MeContextViewExt['activeVoting']>['voting']): Array<{ value: string; label: string; className: string }> {
  const options = voting.options ?? []
  if (options.length > 0) {
    return options.map((o, i) => ({
      value: o.key,
      label: o.label,
      className: CUSTOM_VOTE_TONES[i % CUSTOM_VOTE_TONES.length],
    }))
  }
  return VOTE_OPTIONS
}

function VotingCard({ context }: { context: MeContextViewExt }) {
  const active = context.activeVoting
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const voteMutation = useMutation({
    mutationFn: (value: string) => api.meVote(active!.voting.id, value, crypto.randomUUID()),
    onSuccess: (res) => {
      toast.success('Voto registrado', {
        description: res.receiptPending
          ? `Total de votos na mesa: ${res.registeredCount}. Recibo verificável será emitido no encerramento da votação.`
          : `Total de votos na mesa: ${res.registeredCount}.`,
      })
      setPending(null)
      void queryClient.invalidateQueries({ queryKey: ['me-context'] })
      void queryClient.invalidateQueries({ queryKey: ['me-history'] })
    },
    onError: () => {
      setPending(null)
    },
  })

  if (!active) return null
  const { voting, myVote, eligible } = active
  const secret = voting.mode === 'secreto'
  const canChange = context.tenantSettings.allowVoteChange
  const customOptions = voting.options ?? []
  const buttons = votingButtons(voting)
  const myVoteLabel =
    myVote && myVote.value
      ? (buttons.find((b) => b.value === myVote.value)?.label ?? myVote.value)
      : null

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Vote className="size-4 text-primary" aria-hidden /> Votação aberta
          </CardTitle>
          <VotingModeBadge mode={voting.mode} />
        </div>
        <CardDescription className="text-sm font-medium text-foreground">{voting.question}</CardDescription>
        {customOptions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Opções regimentais desta votação: {customOptions.map((o) => o.label).join(' · ')}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!voting.hidePartial && (
          <p className="text-xs text-muted-foreground">
            Votos registrados: <strong className="tabular-nums">{voting.registeredCount}</strong>
          </p>
        )}

        {myVote ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
            <span className="text-sm font-medium">
              {secret ? 'Voto secreto registrado' : 'Voto registrado:'}
            </span>
            {!secret && myVote.value && myVoteLabel && (
              <Badge className="gap-1 bg-primary text-white hover:bg-primary">{myVoteLabel}</Badge>
            )}
            {myVote.changedAt && <span className="text-xs text-muted-foreground">(alterado)</span>}
          </div>
        ) : null}

        {!eligible ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Registre sua presença nesta sessão para poder votar.
          </p>
        ) : (
          <div
            className={cn('grid gap-2', customOptions.length > 3 ? 'grid-cols-2' : 'grid-cols-3')}
            role="group"
            aria-label="Opções de voto"
          >
            {buttons.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                className={`h-14 min-h-11 text-base font-bold ${opt.className}`}
                disabled={voteMutation.isPending || (!!myVote && !canChange)}
                onClick={() => {
                  setPending(opt.value)
                  setConfirmOpen(true)
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}

        {myVote && !canChange && (
          <p className="text-center text-xs text-muted-foreground">
            A política da Câmara não permite alterar o voto registrado.
          </p>
        )}

        {voting.mode === 'nominal' && (
          <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            Recibo verificável será emitido no encerramento da votação — consulte “Meus recibos”
            no histórico.
          </p>
        )}

        <AlertDialog
          open={confirmOpen}
          onOpenChange={(v) => {
            setConfirmOpen(v)
            if (!v) setPending(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar voto</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-1">
                  <span className="block">{voting.question}</span>
                  <span className="block font-semibold text-foreground">
                    Seu voto: {buttons.find((o) => o.value === pending)?.label ?? pending}
                    {secret ? ' (votação secreta — o valor não será exibido)' : ''}
                  </span>
                  {myVote && <span className="block">Isso substitui seu voto anterior.</span>}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => pending && voteMutation.mutate(pending)}>
                Confirmar voto
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ─── Cartão: fila de oradores ───────────────────────────────────────────────

function SpeechCard({ context }: { context: MeContextViewExt }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SpeechKind>('explicacoes_pessoais')
  const [subject, setSubject] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sessionOpen = context.session?.status === 'open'
  const queue = context.speechQueue

  const mutation = useMutation({
    mutationFn: () => api.meSpeech({ kind, subject: subject.trim() || undefined }),
    onSuccess: (res) => {
      toast.success('Pedido de palavra registrado', {
        description: `Posição ${res.speech.position} na fila (${res.speech.total} no total).`,
      })
      setOpen(false)
      setSubject('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['me-context'] })
    },
  })

  const submit = () => {
    if (!SPEECH_KINDS.includes(kind)) {
      setError('Selecione o tipo de pronunciamento.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mic className="size-4 text-primary" aria-hidden /> Fila de oradores
        </CardTitle>
        <CardDescription>
          {queue.total > 0 ? `${queue.total} pedido(s) na fila.` : 'Fila vazia no momento.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {queue.mine ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <Badge className="gap-1 bg-primary text-white hover:bg-primary">{queue.position}º na fila</Badge>
            <span className="text-sm font-medium">{SPEECH_KIND_LABEL[queue.mine.kind] ?? queue.mine.kind}</span>
            {queue.mine.subject && (
              <span className="text-xs text-muted-foreground">— {queue.mine.subject}</span>
            )}
            <Badge variant="outline" className="ml-auto">Aguardando</Badge>
          </div>
        ) : sessionOpen ? (
          <Button size="lg" className="h-12 w-full text-base font-semibold" onClick={() => setOpen(true)}>
            <Mic className="size-4" aria-hidden /> Pedir a palavra
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            O pedido de palavra pelo app fica disponível com a sessão aberta.
          </p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pedir a palavra</DialogTitle>
            <DialogDescription>
              Você entrará na fila de oradores com o tempo regimental de{' '}
              {Math.round(context.tenantSettings.speechDefaultSeconds / 60)} minutos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="speech-kind">Tipo de pronunciamento *</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as SpeechKind)}>
                <SelectTrigger id="speech-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPEECH_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {SPEECH_KIND_LABEL[k as SpeechKind] ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="speech-subject">Assunto (opcional)</Label>
              <Input
                id="speech-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex.: emenda ao PL 43/2026"
                maxLength={300}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Enviando…' : 'Entrar na fila'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ─── Cartão: histórico pessoal ──────────────────────────────────────────────

const STANDARD_VOTE_VALUES = ['sim', 'nao', 'abstencao']

function MyVoteValueBadge({ value }: { value: VoteValue | null }) {
  if (!value) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Sigiloso
      </Badge>
    )
  }
  if (STANDARD_VOTE_VALUES.includes(value)) {
    return <VoteValueBadge value={value} />
  }
  // Fase 18: chave de opção customizada — exibe a chave (rótulo regimental)
  return (
    <Badge className="bg-primary text-white hover:bg-primary" title="Opção regimental">
      {value}
    </Badge>
  )
}

function ReceiptsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['me-receipts'],
    queryFn: () => api.meReceipts(),
  })

  const receipts: MyVoteReceiptRow[] = data?.receipts ?? []

  return (
    <div className="max-h-80 space-y-1.5 overflow-y-auto custom-scroll pr-1">
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <div className="grid gap-1 p-3 text-center">
          <ReceiptText className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Nenhum recibo emitido ainda — recibos são gerados no encerramento das votações com voto
            individual (nominal).
          </p>
        </div>
      ) : (
        receipts.map((r) => (
          <div
            key={r.id}
            className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium">{r.question}</p>
              <p className="text-xs text-muted-foreground">
                {fmtDateShort(r.closedAt)} · {VOTING_MODE_LABEL[r.mode] ?? r.mode}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-xs font-semibold tracking-wider" aria-label="Código do recibo">
                {r.receiptCode}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">recibo verificável</p>
            </div>
          </div>
        ))
      )}
      <p className="flex items-start gap-1.5 px-1 pt-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
        Cada código é um HMAC determinístico do seu voto (votações secretas comprovam participação,
        sem expor o valor) — a auditoria pode reconferir a reconta.
      </p>
    </div>
  )
}

function HistoryCard({ enabled }: { enabled: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['me-history'],
    queryFn: () => api.meHistory(),
    enabled,
  })

  const attendance = data?.attendance ?? []
  const votes = data?.votes ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" aria-hidden /> Meu histórico
        </CardTitle>
        <CardDescription>Suas presenças, votos e recibos verificáveis.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="attendance">
            <TabsList className="w-full">
              <TabsTrigger value="attendance" className="flex-1">
                Presenças
              </TabsTrigger>
              <TabsTrigger value="votes" className="flex-1">
                Votos
              </TabsTrigger>
              <TabsTrigger value="receipts" className="flex-1">
                Recibos
              </TabsTrigger>
            </TabsList>
            <TabsContent value="attendance" className="mt-3">
              <div className="max-h-80 space-y-1.5 overflow-y-auto custom-scroll pr-1">
                {attendance.length === 0 ? (
                  <p className="p-3 text-center text-sm text-muted-foreground">
                    Nenhuma sessão iniciada ainda.
                  </p>
                ) : (
                  attendance.map((a) => (
                    <div
                      key={a.sessionId}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          Sessão nº {a.number}/{a.year}
                        </p>
                        <p className="text-xs text-muted-foreground">{fmtDateShort(a.date)}</p>
                      </div>
                      <PresenceBadge status={a.status} />
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
            <TabsContent value="votes" className="mt-3">
              <div className="max-h-80 space-y-1.5 overflow-y-auto custom-scroll pr-1">
                {votes.length === 0 ? (
                  <p className="p-3 text-center text-sm text-muted-foreground">
                    Nenhum voto registrado ainda.
                  </p>
                ) : (
                  votes.map((v) => (
                    <div
                      key={`${v.votingId}-${v.closedAt ?? 'x'}`}
                      className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium">{v.question}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.closedAt ? fmtDateShort(v.closedAt) : 'em andamento'}
                        </p>
                      </div>
                      {v.value ? (
                        <MyVoteValueBadge value={v.value} />
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Sigiloso
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
            <TabsContent value="receipts" className="mt-3">
              <ReceiptsTab />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}

// ─── App completo ───────────────────────────────────────────────────────────

function ParliamentarianApp() {
  const queryClient = useQueryClient()
  const connection = useApp((s) => s.connection)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['me-context'],
    queryFn: () => api.meContext(),
    refetchInterval: 15_000,
    retry: 1,
  })
  const { data: noticeData } = useQuery({
    queryKey: ['me-notice', data?.session?.id],
    queryFn: () => api.meNotice(data!.session!.id),
    enabled: !!data?.session?.id,
    refetchInterval: 15_000,
  })
  const acknowledge = useMutation({
    mutationFn: (notice: { sessionId: string; revision: number; noticeSha256: string }) => api.acknowledgeNotice(notice),
    onSuccess: () => {
      toast.success('Ciência da convocação registrada')
      void queryClient.invalidateQueries({ queryKey: ['me-notice', data?.session?.id] })
    },
  })

  // Tempo real: qualquer evento relevante invalida o contexto vivo.
  useRealtime({
    'session.state_changed': () => {
      void queryClient.invalidateQueries({ queryKey: ['me-context'] })
      void queryClient.invalidateQueries({ queryKey: ['me-notice'] })
      // F22: encerramento/publicação da ata muda o card “Assinar ata”
      // (alvo = última sessão encerrada — ver SignAtaCard).
      void queryClient.invalidateQueries({ queryKey: ['me-ata-signatures'] })
      void queryClient.invalidateQueries({ queryKey: ['me-ata-closed-session'] })
    },
    'session.quorum': () => void queryClient.invalidateQueries({ queryKey: ['me-context'] }),
    'attendance.changed': () => void queryClient.invalidateQueries({ queryKey: ['me-context'] }),
    'voting.state_changed': () => {
      void queryClient.invalidateQueries({ queryKey: ['me-context'] })
      // Fase 18: recibos são emitidos no encerramento — atualiza “Meus recibos”
      void queryClient.invalidateQueries({ queryKey: ['me-receipts'] })
    },
    'voting.created': () => void queryClient.invalidateQueries({ queryKey: ['me-context'] }),
    'vote.recorded': () => {
      void queryClient.invalidateQueries({ queryKey: ['me-context'] })
      void queryClient.invalidateQueries({ queryKey: ['me-history'] })
    },
    'speech.state_changed': () => void queryClient.invalidateQueries({ queryKey: ['me-context'] }),
  })

  const checkIn = useMutation({
    mutationFn: () => api.meCheckIn(),
    onSuccess: (res) => {
      toast.success('Presença registrada', {
        description: `Quórum atual: ${res.quorum.present}/${res.quorum.required}.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['me-context'] })
      void queryClient.invalidateQueries({ queryKey: ['me-history'] })
    },
  })

  const initials = useMemo(
    () =>
      (data?.parliamentarian.name ?? '')
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join(''),
    [data?.parliamentarian.name]
  )

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      {/* Identidade + conexão (sempre visível) */}
      <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-bold text-primary"
          aria-hidden
        >
          {initials || '—'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{data?.parliamentarian.name ?? 'Carregando…'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {data?.parliamentarian.party}
            {data?.parliamentarian.bloc ? ` · ${data.parliamentarian.bloc}` : ''}
          </p>
        </div>
        <ConnectionBadge state={connection} />
      </div>

      {isLoading ? (
        <>
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </>
      ) : isError || !data ? (
        <EmptyState
          icon={<Smartphone />}
          title="Não foi possível carregar seu contexto"
          description="Verifique sua conexão e tente novamente."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : (
        <>
          <SessionCard context={data} onCheckIn={() => checkIn.mutate()} checkingIn={checkIn.isPending} />
          {noticeData?.notice && <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Convocação · revisão {noticeData.notice.revision}</CardTitle>
              <CardDescription>Emitida em {fmtDateTime(noticeData.notice.issuedAt)}. Leia a convocação antes de confirmar ciência.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {noticeData.notice.publicUrl && <a className="text-sm font-medium text-primary underline" href={noticeData.notice.publicUrl} target="_blank" rel="noopener noreferrer">Ler convocação e pauta completas</a>}
              <p className="break-all text-xs text-muted-foreground">SHA-256: {noticeData.notice.noticeSha256}</p>
              {noticeData.notice.acknowledgedAt ? <p className="text-sm text-primary">Ciência registrada em {fmtDateTime(noticeData.notice.acknowledgedAt)}</p> :
                <Button className="w-full" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ sessionId: noticeData.notice!.sessionId, revision: noticeData.notice!.revision, noticeSha256: noticeData.notice!.noticeSha256 })}>
                  {acknowledge.isPending ? 'Registrando…' : 'Confirmar ciência da convocação'}
                </Button>}
              <p className="text-xs text-muted-foreground">Esta confirmação registra sua leitura no sistema; não registra voto nem comprova entrega externa.</p>
            </CardContent>
          </Card>}
          <SignAtaCard context={data} />
          <VotingCard context={data} />
          <SpeechCard context={data} />
          <HistoryCard enabled />
          <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-muted-foreground">
            <CalendarClock className="size-3" aria-hidden />
            Atualização automática por tempo real (15s de garantia) · votos sujeitos às regras regimentais
          </p>
        </>
      )}
    </div>
  )
}

export default function PwaModule() {
  const actor = useApp((s) => s.actor)

  return (
    <div className="space-y-6">
      <PageHeader
        title="App do Parlamentar"
        description="Presença, voto e palavra direto do celular — as mesmas regras da mesa do plenário, sem atalhos."
        icon={<Smartphone />}
      />

      {actor?.role === 'parliamentarian' ? (
        <ParliamentarianApp />
      ) : (
        <div className="mx-auto w-full max-w-md">
          <EmptyState
            icon={<ClipboardList />}
            title={actor ? `Perfil atual: ${actor.name} (${ROLE_LABEL[actor.role]})` : 'Selecione um perfil'}
            description="Este módulo é exclusivo de parlamentares. Troque o perfil de acesso no menu do topo (canto superior direito) para um vereador — por exemplo, Carla Mendes — e volte aqui para registrar presença, votar e pedir a palavra."
          />
          <Separator className="my-4" />
          <p className="text-center text-xs text-muted-foreground">
            A troca de perfil altera as permissões verificadas no servidor (RBAC).
          </p>
        </div>
      )}
    </div>
  )
}
