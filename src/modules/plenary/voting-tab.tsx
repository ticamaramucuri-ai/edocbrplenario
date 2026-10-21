'use client'

/**
 * Tab Votação — painel da votação em foco (pronta/aberta/pausada ou o
 * último resultado), grade de lançamento de votos, resultado nominal
 * agregado, histórico da sessão e, na Fase 18 (Onda 4), painel de recibos
 * verificáveis (verificação HMAC determinística) e opções customizadas.
 */

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CircleSlash,
  Gavel,
  HelpCircle,
  Lock,
  Minus,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Vote,
  X,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type {
  AttendanceRow,
  ReceiptsVerificationView,
  ResultCounts,
  SessionDetail,
  VotingOptionView,
  VotingView,
} from '@/lib/contracts'
import { VOTING_RULE_LABEL } from '@/lib/contracts'
import { fmtTime } from '@/lib/format'
import { EmptyState } from '@/components/app/page-header'
import { ResultBadge, VoteValueBadge, VotingModeBadge, VotingStatusBadge } from '@/components/app/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { pickActiveVoting } from './helpers'

type Props = { data: SessionDetail; invalidate: () => void }

const TRANSITION_SUCCESS: Record<string, string> = {
  open: 'Votação aberta',
  pause: 'Votação pausada',
  resume: 'Votação retomada',
  close: 'Votação encerrada — resultado apurado',
  annul: 'Votação anulada',
  cancel: 'Votação cancelada',
}

/** Fase 18 — opções regimentais da votação ([] = padrão Sim/Não/Abstenção). */
function votingOptions(voting: VotingView): VotingOptionView[] {
  return voting.options ?? []
}

/** Badge de valor de voto — padrão regimental ou chave/rótulo customizado. */
function ValueBadge({ value, options }: { value: string | null; options: VotingOptionView[] }) {
  if (value === 'sim' || value === 'nao' || value === 'abstencao' || value === 'nao_registrado' || value === null) {
    return <VoteValueBadge value={value ?? 'nao_registrado'} />
  }
  const option = options.find((o) => o.key === value)
  return (
    <Badge className="gap-1 bg-primary text-white hover:bg-primary">
      <BadgeCheck className="size-3" aria-hidden /> {option?.label ?? value}
    </Badge>
  )
}

export function VotingTab({ data, invalidate }: Props) {
  const active = pickActiveVoting(data.votings)

  if (!active) {
    return (
      <EmptyState
        icon={<Gavel />}
        title="Nenhuma votação nesta sessão"
        description="Na aba Pauta, use “Iniciar votação” em um item pendente, em leitura ou em discussão. A sessão precisa estar aberta, suspensa ou retomada."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <VotingPanel voting={active} data={data} invalidate={invalidate} />
      <History votings={data.votings.filter((v) => v.id !== active.id)} />
    </div>
  )
}

// ─── Painel da votação em foco ─────────────────────────────────────────────

function VotingPanel({
  voting,
  data,
  invalidate,
}: {
  voting: VotingView
  data: SessionDetail
  invalidate: () => void
}) {
  const can = useApp((s) => s.can)
  const canWrite = can('voting.write')
  const canSeeReceipts = can('voting.write') || can('audit.read')
  const options = votingOptions(voting)
  const [closeOpen, setCloseOpen] = useState(false)
  const [annulOpen, setAnnulOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [impededPerson, setImpededPerson] = useState('')
  const [impedimentReason, setImpedimentReason] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revocationReason, setRevocationReason] = useState('')
  const impedimentQuery = useQuery({ queryKey: ['voting-impediments', voting.id],
    queryFn: () => api.votingImpediments(voting.id), enabled: canWrite })
  const officialSymbolic = data.session.official && voting.mode === 'simbolico'
  const tallyQuery = useQuery({ queryKey: ['symbolic-tallies', voting.id, voting.version],
    queryFn: () => api.symbolicTallies(voting.id), enabled: canWrite && officialSymbolic })
  const latestTally = tallyQuery.data?.revisions[0]
  const tallyMutation = useMutation({
    mutationFn: (vars: { action: 'propose' | 'confirm'; revisionId?: string; sim?: number; nao?: number;
      abstencoes?: number; customCounts?: Record<string, number> }) =>
      api.changeSymbolicTally(voting.id, { ...vars, version: voting.version }),
    onSuccess: () => { invalidate(); tallyQuery.refetch(); toast.success('Conferência simbólica atualizada') },
  })
  const impedimentMutation = useMutation({
    mutationFn: (vars: { action: 'register' | 'revoke'; parliamentarianId: string; reason: string }) =>
      api.changeVotingImpediment(voting.id, { ...vars, version: voting.version }),
    onSuccess: () => { setImpededPerson(''); setImpedimentReason(''); setRevokingId(null); setRevocationReason(''); invalidate(); impedimentQuery.refetch();
      toast.success('Impedimento atualizado') },
  })

  const transition = useMutation({
    mutationFn: (vars: {
      action: string
      extra?: { justification?: string; sim?: number; nao?: number; abstencoes?: number; customCounts?: Record<string, number> }
    }) => api.transitionVoting(voting.id, vars.action, voting.version, vars.extra),
    onSuccess: (_r, vars) => {
      invalidate()
      toast.success(TRANSITION_SUCCESS[vars.action] ?? 'Votação atualizada')
    },
  })

  const presentCount = voting.presentAtOpen ?? data.quorum.present
  const registered = voting.registeredCount
  const pct = presentCount > 0 ? Math.min(100, Math.round((registered / presentCount) * 100)) : 0
  const showGrid = voting.status === 'open' && voting.mode !== 'simbolico'
  const showResult = voting.status === 'closed' || voting.status === 'annulled'

  return (
    <Card className="overflow-hidden border-primary/25">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg font-semibold leading-snug">{voting.question}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <VotingModeBadge mode={voting.mode} />
              <VotingStatusBadge status={voting.status} />
              <Badge variant="outline" className="gap-1">
                <Scale className="size-3" /> {VOTING_RULE_LABEL[voting.rule]}
              </Badge>
              {voting.openedAt && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Aberta às {fmtTime(voting.openedAt)}
                </span>
              )}
              {voting.closedAt && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Encerrada às {fmtTime(voting.closedAt)}
                </span>
              )}
            </div>
          </div>

          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              {voting.status === 'ready' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)} disabled={transition.isPending}>
                    <CircleSlash /> Cancelar
                  </Button>
                  <Button size="sm" onClick={() => transition.mutate({ action: 'open' })} disabled={transition.isPending}>
                    <PlayCircle /> Abrir votação
                  </Button>
                </>
              )}

              {voting.status === 'open' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => transition.mutate({ action: 'pause' })}
                    disabled={transition.isPending}
                  >
                    <PauseCircle /> Pausar
                  </Button>
                  <Button size="sm" onClick={() => officialSymbolic && latestTally?.confirmedAt
                    ? transition.mutate({ action: 'close' }) : setCloseOpen(true)} disabled={transition.isPending || tallyMutation.isPending}>
                    <Lock /> {officialSymbolic && !latestTally?.confirmedAt ? 'Conferir contagem' : 'Encerrar votação'}
                  </Button>
                </>
              )}

              {voting.status === 'paused' && (
                <>
                  <Button
                    size="sm"
                    onClick={() => transition.mutate({ action: 'resume' })}
                    disabled={transition.isPending}
                  >
                    <PlayCircle /> Retomar
                  </Button>
                  <Button size="sm" onClick={() => officialSymbolic && latestTally?.confirmedAt
                    ? transition.mutate({ action: 'close' }) : setCloseOpen(true)} disabled={transition.isPending || tallyMutation.isPending}>
                    <Lock /> {officialSymbolic && !latestTally?.confirmedAt ? 'Conferir contagem' : 'Encerrar votação'}
                  </Button>
                </>
              )}

              {voting.status === 'closed' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setAnnulOpen(true)}
                  disabled={transition.isPending}
                >
                  <CircleSlash /> Anular votação
                </Button>
              )}
            </div>
          )}
        </div>

        {officialSymbolic && ['open', 'paused'].includes(voting.status) && <div className="rounded-lg border p-3 text-sm">
          {latestTally ? <>
            <p>Contagem proposta por {latestTally.proposedByName} · revisão {latestTally.revision}.
              {latestTally.confirmedAt ? ` Confirmada por ${latestTally.confirmedByName}.` : ' Aguarda conferência independente.'}</p>
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
              {Object.entries(latestTally.counts).map(([key, count]) => <div key={key} className="flex gap-1">
                <dt>{options.find((option) => option.key === key)?.label ?? ({ sim: 'Sim', nao: 'Não', abstencoes: 'Abstenções' }[key as 'sim' | 'nao' | 'abstencoes'] ?? key)}:</dt>
                <dd className="font-semibold">{count}</dd>
              </div>)}
            </dl>
            {!latestTally.confirmedAt && canWrite && <Button className="mt-2" size="sm" variant="outline"
              disabled={tallyMutation.isPending} onClick={() => tallyMutation.mutate({ action: 'confirm', revisionId: latestTally.id })}>
              Confirmar como segunda pessoa
            </Button>}
          </> : <p>Registre a contagem; uma segunda pessoa deverá confirmá-la antes do encerramento.</p>}
        </div>}

        {/* Progresso de participação */}
        {voting.status !== 'cancelled' && <div>
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {registered} de {presentCount} {presentCount === 1 ? 'parlamentar registrou' : 'parlamentares registraram'}{' '}
              {voting.hidePartial && voting.status === 'open' && '· valores ocultos (resultados parciais ocultos)'}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <Progress value={pct} aria-label={`${registered} de ${presentCount} votos registrados`} />
        </div>}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {voting.status === 'ready' && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Votação pronta. Ao abrir, o sistema registra o quórum do momento — a abertura exige
            quórum mínimo ({voting.requiredQuorum ?? data.quorum.required} presentes).
          </p>
        )}
        {canWrite && impedimentQuery.data && (
          <div className="rounded-lg border p-3 text-sm">
            <h3 className="font-semibold">Impedimentos desta votação</h3>
            <p className="mt-1 text-xs text-muted-foreground">{impedimentQuery.data.policyAtOpen
              ? `Política congelada na abertura: ${impedimentQuery.data.policyAtOpen === 'reduce_base' ? 'reduz a base da maioria absoluta' : 'mantém a base da maioria absoluta'}.`
              : impedimentQuery.data.policy === 'disabled' ? 'Recurso desativado nas configurações desta Câmara.'
                : `Política atual: ${impedimentQuery.data.policy === 'reduce_base' ? 'reduz' : 'mantém'} a base da maioria absoluta.`}</p>
            {impedimentQuery.data.impediments.map((item) => <div key={item.id} className="mt-2 flex items-start justify-between gap-2 border-t pt-2">
              <span><strong>{item.parliamentarianName}</strong> — {item.reason}</span>
              {voting.status === 'ready' && <Button size="sm" variant="outline" disabled={impedimentMutation.isPending}
                onClick={() => setRevokingId(item.parliamentarianId)}>
                Revogar
              </Button>}
            </div>)}
            {voting.status === 'ready' && impedimentQuery.data.policy !== 'disabled' && (
              <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-[1fr_2fr_auto]">
                <select aria-label="Parlamentar impedido" className="h-9 rounded-md border bg-background px-2" value={impededPerson}
                  onChange={(e) => setImpededPerson(e.target.value)}>
                  <option value="">Selecione o parlamentar</option>
                  {data.attendance.filter((row) => !impedimentQuery.data.impediments.some((item) => item.parliamentarianId === row.parliamentarianId))
                    .map((row) => <option key={row.parliamentarianId} value={row.parliamentarianId}>{row.name}</option>)}
                </select>
                <Input aria-label="Justificativa do impedimento" placeholder="Justificativa (mínimo 10 caracteres)" value={impedimentReason}
                  onChange={(e) => setImpedimentReason(e.target.value)} />
                <Button size="sm" disabled={!impededPerson || impedimentReason.trim().length < 10 || impedimentMutation.isPending}
                  onClick={() => impedimentMutation.mutate({ action: 'register', parliamentarianId: impededPerson, reason: impedimentReason.trim() })}>
                  Registrar
                </Button>
              </div>
            )}
          </div>
        )}
        {voting.status === 'paused' && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Votação pausada — os votos já registrados são mantidos.
          </p>
        )}
        {voting.status === 'annulled' && voting.justification && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <strong>Votação anulada.</strong> Justificativa: {voting.justification}
          </p>
        )}
        {voting.status === 'cancelled' && voting.justification && (
          <p className="rounded-lg border border-dashed p-3 text-sm">
            <strong>Votação cancelada antes da abertura.</strong> Justificativa: {voting.justification}
          </p>
        )}

        {showGrid && (
          <VotingGrid voting={voting} present={data.attendance.filter((a) => a.present &&
            (!voting.eligibleVoterIdsAtOpen || voting.eligibleVoterIdsAtOpen.includes(a.parliamentarianId)))} invalidate={invalidate} />
        )}

        {showResult && <VotingResult voting={voting} />}

        {showResult && canSeeReceipts && (
          <ReceiptsPanel voting={voting} canRead={canSeeReceipts} />
        )}
      </CardContent>

      {/* Encerramento */}
      {voting.mode === 'simbolico' ? (
        <CloseSymbolicDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          presentCount={presentCount}
          options={options}
          busy={transition.isPending || tallyMutation.isPending}
          official={officialSymbolic}
          onConfirm={(counts) => {
            setCloseOpen(false)
            if (officialSymbolic) tallyMutation.mutate({ action: 'propose', ...counts })
            else transition.mutate({ action: 'close', extra: counts })
          }}
        />
      ) : (
        <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-primary" /> Encerrar a votação?
              </AlertDialogTitle>
              <AlertDialogDescription>
                O sistema apura o resultado ({VOTING_RULE_LABEL[voting.rule]}), atualiza a matéria e o
                item da pauta automaticamente. Parlamentares que não registraram voto contam como
                “não registraram”.
                {voting.mode === 'nominal' &&
                  ' No encerramento, cada voto nominal recebe um recibo verificável (HMAC determinístico) publicado para conferência da auditoria.'}
                {voting.mode === 'secreto' &&
                  ' Votação secreta: o recibo comprova participação, sem expor o valor.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={transition.isPending}
                onClick={(e) => {
                  e.preventDefault()
                  setCloseOpen(false)
                  transition.mutate({ action: 'close' })
                }}
              >
                Encerrar e apurar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Anulação */}
      <AnnulDialog
        open={annulOpen}
        onOpenChange={setAnnulOpen}
        busy={transition.isPending}
        onConfirm={(justification) => {
          setAnnulOpen(false)
          transition.mutate({ action: 'annul', extra: { justification } })
        }}
      />
      <CancelVotingDialog open={cancelOpen} onOpenChange={setCancelOpen} busy={transition.isPending}
        onConfirm={(justification) => { setCancelOpen(false); transition.mutate({ action: 'cancel', extra: { justification } }) }} />
      <Dialog open={!!revokingId} onOpenChange={(open) => { if (!open) { setRevokingId(null); setRevocationReason('') } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revogar impedimento</DialogTitle>
            <DialogDescription>Informe o motivo da correção. A revogação ficará registrada na auditoria.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Justificativa da revogação" value={revocationReason}
            onChange={(e) => setRevocationReason(e.target.value)} placeholder="Justificativa (mínimo 10 caracteres)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevokingId(null); setRevocationReason('') }}>Cancelar</Button>
            <Button disabled={!revokingId || revocationReason.trim().length < 10 || impedimentMutation.isPending}
              onClick={() => { if (revokingId) impedimentMutation.mutate({ action: 'revoke', parliamentarianId: revokingId,
                reason: revocationReason.trim() }) }}>Confirmar revogação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ─── Grade de lançamento de votos ──────────────────────────────────────────

function VotingGrid({
  voting,
  present,
  invalidate,
}: {
  voting: VotingView
  present: AttendanceRow[]
  invalidate: () => void
}) {
  const options = votingOptions(voting)
  const cast = useMutation({
    mutationFn: (vars: { pid: string; value: string }) =>
      api.castVote(voting.id, vars.pid, vars.value, crypto.randomUUID()),
    onSuccess: () => invalidate(),
  })

  const hideValues = voting.mode === 'secreto' || voting.hidePartial
  const buttonTones = ['emerald', 'rose', 'amber'] as const

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Vote className="size-4 text-primary" /> Lançamento de votos
        </h3>
        {voting.mode === 'secreto' && (
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            Votação secreta — o valor é registrado, mas nunca exibido
          </Badge>
        )}
        {options.length > 0 && (
          <Badge variant="outline" className="border-primary/50 text-primary">
            Opções regimentais customizadas
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {present.map((m) => {
          const row = voting.votes?.find((v) => v.parliamentarianId === m.parliamentarianId) ?? null
          const voted = !!row
          const busy = cast.isPending && cast.variables?.pid === m.parliamentarianId
          return (
            <Card key={m.parliamentarianId} className="gap-0">
              <CardContent className="flex flex-col gap-2.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <Badge variant="outline" className="mt-0.5 font-mono text-[10px]">
                      {m.party}
                    </Badge>
                  </div>
                  <div className="shrink-0">
                    {voted ? (
                      hideValues ? (
                        <Badge className="bg-emerald-700 text-white">
                          <Check /> {voting.mode === 'secreto' ? 'Voto registrado' : 'Registrado'}
                        </Badge>
                      ) : row?.value ? (
                        <ValueBadge value={row.value} options={options} />
                      ) : (
                        <Badge className="bg-emerald-700 text-white">
                          <Check /> Registrado
                        </Badge>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground" aria-label="Aguardando voto">
                        —
                      </span>
                    )}
                  </div>
                </div>
                {options.length > 0 ? (
                  <div
                    className="grid gap-1.5"
                    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
                  >
                    {options.map((o, i) => (
                      <VoteButton
                        key={o.key}
                        label={o.label}
                        icon={<BadgeCheck />}
                        tone={i < buttonTones.length ? buttonTones[i] : 'zinc'}
                        disabled={busy}
                        onClick={() => cast.mutate({ pid: m.parliamentarianId, value: o.key })}
                        aria={`Registrar voto “${o.label}” de ${m.name}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    <VoteButton
                      label="Sim"
                      icon={<Check />}
                      tone="emerald"
                      disabled={busy}
                      onClick={() => cast.mutate({ pid: m.parliamentarianId, value: 'sim' })}
                      aria={`Registrar voto Sim de ${m.name}`}
                    />
                    <VoteButton
                      label="Não"
                      icon={<X />}
                      tone="rose"
                      disabled={busy}
                      onClick={() => cast.mutate({ pid: m.parliamentarianId, value: 'nao' })}
                      aria={`Registrar voto Não de ${m.name}`}
                    />
                    <VoteButton
                      label="Abstenção"
                      icon={<Minus />}
                      tone="amber"
                      disabled={busy}
                      onClick={() => cast.mutate({ pid: m.parliamentarianId, value: 'abstencao' })}
                      aria={`Registrar abstenção de ${m.name}`}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function VoteButton({
  label,
  icon,
  tone,
  disabled,
  onClick,
  aria,
}: {
  label: string
  icon: React.ReactNode
  tone: 'emerald' | 'rose' | 'amber' | 'zinc'
  disabled: boolean
  onClick: () => void
  aria: string
}) {
  const tones = {
    emerald:
      'border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950',
    rose: 'border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950',
    amber:
      'border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950',
    zinc:
      'border-zinc-300 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900',
  }
  return (
    <Button size="sm" variant="outline" className={cn('h-9 font-semibold', tones[tone])} disabled={disabled} onClick={onClick} aria-label={aria}>
      {icon} {label}
    </Button>
  )
}

// ─── Resultado ─────────────────────────────────────────────────────────────

function VotingResult({ voting }: { voting: VotingView }) {
  const counts: ResultCounts | null = voting.resultCounts
  const secret = voting.mode === 'secreto'
  const options = votingOptions(voting)
  const custom = counts?.custom ?? null
  const nominalRows = (voting.votes ?? []).filter((v) => v.value !== null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ResultBadge result={voting.resultStatus} />
        {voting.presentAtOpen !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Quórum na abertura: {voting.presentAtOpen}
            {voting.presentAtClose !== null ? ` · no encerramento: ${voting.presentAtClose}` : ''}
          </span>
        )}
      </div>

      {counts && custom && options.length > 0 ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(options.length + 1, 5)}, minmax(0, 1fr))` }}
        >
          {options.map((o, i) => (
            <CountCard
              key={o.key}
              label={o.label}
              value={custom[o.key] ?? 0}
              tone={i === 0 ? 'emerald' : i === 1 ? 'rose' : i === 2 ? 'amber' : 'zinc'}
            />
          ))}
          <CountCard label="Não registraram" value={counts.naoRegistraram} tone="zinc" />
        </div>
      ) : counts ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CountCard label="Sim" value={counts.sim} tone="emerald" />
          <CountCard label="Não" value={counts.nao} tone="rose" />
          <CountCard label="Abstenções" value={counts.abstencoes} tone="amber" />
          <CountCard label="Não registraram" value={counts.naoRegistraram} tone="zinc" />
        </div>
      ) : null}

      {secret ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Votação secreta — apenas o resultado agregado é divulgado; os valores individuais não são
          exibidos nem auditáveis em tela.
        </p>
      ) : nominalRows.length > 0 ? (
        <div className="max-h-96 overflow-y-auto custom-scroll rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Parlamentar</TableHead>
                <TableHead className="hidden sm:table-cell">Partido</TableHead>
                <TableHead>Voto</TableHead>
                <TableHead className="text-right">Registrado às</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nominalRows.map((v) => (
                <TableRow key={v.parliamentarianId}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                    {v.party}
                  </TableCell>
                  <TableCell>
                    <ValueBadge value={v.value} options={options} />
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {fmtTime(v.receivedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}

function CountCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'rose' | 'amber' | 'zinc' }) {
  const tones = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
    zinc: 'text-muted-foreground',
  }
  return (
    <Card className="gap-0">
      <CardContent className="p-4">
        <p className="line-clamp-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-4xl font-bold tabular-nums', tones[tone])}>{value}</p>
      </CardContent>
    </Card>
  )
}

// ─── Fase 18: painel de recibos verificáveis ───────────────────────────────

function ReceiptsPanel({ voting, canRead }: { voting: VotingView; canRead: boolean }) {
  // Recibos aplicam-se a: nominal (sempre), secreto (participação) e simbólico
  // apenas quando há votos individuais registrados.
  const receiptsApply =
    voting.mode === 'nominal' || voting.mode === 'secreto' || voting.registeredCount > 0

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['voting-receipts', voting.id],
    queryFn: () => api.votingReceipts(voting.id),
    enabled: canRead && voting.status === 'closed' && receiptsApply,
    retry: 1,
  })

  if (!receiptsApply || voting.status !== 'closed') return null

  const verification: ReceiptsVerificationView | undefined = data

  return (
    <Card className="border-primary/25">
      <CardHeader className="gap-2 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-primary" aria-hidden /> Recibos verificáveis
            <Badge variant="outline" className="font-mono text-[10px]">
              HMAC-SHA256
            </Badge>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching || isLoading}
          >
            <RefreshCw className={cn(isFetching && 'animate-spin')} /> Reverificar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-9 w-full animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : isError || !verification ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" aria-hidden /> Não foi possível carregar a
            verificação de recibos.
          </p>
        ) : (
          <>
            {verification.ok ? (
              <p
                className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                role="status"
              >
                <ShieldCheck className="size-4 shrink-0" aria-hidden /> Verificação OK —{' '}
                {verification.recomputedCount}{' '}
                {verification.recomputedCount === 1 ? 'recibo conferido' : 'recibos conferidos'}.
              </p>
            ) : (
              <p
                className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
                role="alert"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden />{' '}
                {verification.mismatchCount}{' '}
                {verification.mismatchCount === 1 ? 'divergência' : 'divergências'} na reconta
                determinística (de {verification.recomputedCount} votos) — acione a auditoria.
              </p>
            )}

            {voting.mode === 'secreto' && (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Votação secreta — os recibos provam participação, os valores de voto não são expostos.
              </p>
            )}

            {verification.receipts.length > 0 ? (
              <div className="max-h-64 overflow-y-auto custom-scroll rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Parlamentar</TableHead>
                      <TableHead className="text-right">Código do recibo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {verification.receipts.map((r) => (
                      <TableRow key={r.parliamentarianId}>
                        <TableCell className="font-medium">{r.parliamentarianName}</TableCell>
                        <TableCell className="text-right font-mono text-xs tracking-wider">
                          {r.receiptCode}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhum recibo emitido (votos individuais registrados: {verification.recomputedCount}
                — divergências incluem votos sem recibo persistido).
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Emissão idempotente no encerramento ({fmtTime(voting.closedAt)}); a reconta usa o mesmo
              HMAC determinístico por tenant (ADR-019).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Encerramento de votação simbólica ─────────────────────────────────────

function CloseSymbolicDialog({
  open,
  onOpenChange,
  presentCount,
  options,
  busy,
  official,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presentCount: number
  /** Fase 18: opções customizadas — contagem por chave em vez de sim/nao/abstencoes. */
  options: VotingOptionView[]
  busy: boolean
  official: boolean
  onConfirm: (counts: { sim: number; nao: number; abstencoes: number } | { customCounts: Record<string, number> }) => void
}) {
  const [sim, setSim] = useState(0)
  const [nao, setNao] = useState(0)
  const [abst, setAbst] = useState(0)
  const [customCounts, setCustomCounts] = useState<Record<string, number>>({})

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="size-5 text-primary" /> Encerrar votação simbólica
          </DialogTitle>
          <DialogDescription>
            {official ? 'Proponha a contagem para conferência por outra pessoa. ' : 'Informe as contagens apuradas pela Presidência. '}
            Parlamentares presentes que não entram
            nas contagens são registrados como “não registraram” ({presentCount} presentes na
            abertura).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {options.length > 0 ? (
            <>
              <div className="grid gap-3">
                {options.map((o) => (
                  <div key={o.key} className="grid gap-1.5">
                    <Label htmlFor={`cnt-${o.key}`}>{o.label}</Label>
                    <Input
                      id={`cnt-${o.key}`}
                      type="number"
                      min={0}
                      value={customCounts[o.key] ?? 0}
                      onChange={(e) =>
                        setCustomCounts((prev) => ({
                          ...prev,
                          [o.key]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="tabular-nums"
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setCustomCounts(
                    Object.fromEntries(options.map((o, i) => [o.key, i === 0 ? presentCount : 0]))
                  )
                }
              >
                <Check /> Todos na primeira opção ({options[0]?.label})
              </Button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cnt-sim">Sim</Label>
                  <Input
                    id="cnt-sim"
                    type="number"
                    min={0}
                    value={sim}
                    onChange={(e) => setSim(Math.max(0, Number(e.target.value) || 0))}
                    className="tabular-nums"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cnt-nao">Não</Label>
                  <Input
                    id="cnt-nao"
                    type="number"
                    min={0}
                    value={nao}
                    onChange={(e) => setNao(Math.max(0, Number(e.target.value) || 0))}
                    className="tabular-nums"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cnt-abst">Abstenções</Label>
                  <Input
                    id="cnt-abst"
                    type="number"
                    min={0}
                    value={abst}
                    onChange={(e) => setAbst(Math.max(0, Number(e.target.value) || 0))}
                    className="tabular-nums"
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSim(presentCount)
                  setNao(0)
                  setAbst(0)
                }}
              >
                <Check /> Unanimidade (todos sim)
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            onClick={() =>
              onConfirm(
                options.length > 0
                  ? {
                      customCounts: Object.fromEntries(
                        options.map((o) => [o.key, customCounts[o.key] ?? 0])
                      ),
                    }
                  : { sim, nao, abstencoes: abst }
              )
            }
            disabled={busy}
          >
            {official ? 'Enviar para conferência' : 'Encerrar e apurar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Anulação ──────────────────────────────────────────────────────────────

function CancelVotingDialog({ open, onOpenChange, busy, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  onConfirm: (justification: string) => void
}) {
  const [justification, setJustification] = useState('')
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancelar votação antes da abertura?</AlertDialogTitle>
        <AlertDialogDescription>O item de pauta voltará ao estado anterior. O cancelamento e sua justificativa ficarão na auditoria.</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="cancel-voting-reason">Justificativa</Label>
        <Textarea id="cancel-voting-reason" value={justification} onChange={(e) => setJustification(e.target.value)}
          rows={3} maxLength={2000} placeholder="Informe o motivo do cancelamento" />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Voltar</AlertDialogCancel>
        <AlertDialogAction disabled={busy || justification.trim().length < 3} onClick={(e) => {
          e.preventDefault(); onConfirm(justification.trim()); setJustification('')
        }}>Cancelar votação</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function AnnulDialog({
  open,
  onOpenChange,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  onConfirm: (justification: string) => void
}) {
  const [justification, setJustification] = useState('')
  const valid = justification.trim().length >= 3

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CircleSlash className="size-5 text-destructive" /> Anular votação?
          </AlertDialogTitle>
          <AlertDialogDescription>
            A anulação reverte a matéria e o item da pauta para o estado anterior e exige
            justificativa registrada em auditoria. Não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="annul-justification">
            Justificativa <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="annul-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Ex.: Erro de colocação da matéria em votação…"
          />
          {justification.trim().length > 0 && !valid && (
            <p className="text-xs text-destructive">Informe ao menos 3 caracteres.</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={!valid || busy}
            onClick={(e) => {
              e.preventDefault()
              onConfirm(justification.trim())
            }}
          >
            Anular votação
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Histórico ─────────────────────────────────────────────────────────────

function History({ votings }: { votings: VotingView[] }) {
  if (votings.length === 0) return null
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HelpCircle className="size-4 text-muted-foreground" /> Histórico de votações da sessão
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="max-h-72 divide-y overflow-y-auto custom-scroll">
          {[...votings].reverse().map((v) => {
            const custom = v.resultCounts?.custom
            const options = votingOptions(v)
            const countsLabel = custom
              ? options.length > 0
                ? `${options
                    .map((o) => custom[o.key] ?? 0)
                    .reduce((a, b) => a + b, 0)} votos · ${options.length} opções`
                : `${Object.values(custom).reduce((a, b) => a + b, 0)} votos`
              : v.resultCounts
                ? `${v.resultCounts.sim}S · ${v.resultCounts.nao}N · ${v.resultCounts.abstencoes}A`
                : null
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate" title={v.question}>
                  {v.question}
                </span>
                {options.length > 0 && (
                  <Badge variant="outline" className="border-primary/50 text-[10px] text-primary">
                    opções regimentais
                  </Badge>
                )}
                <VotingStatusBadge status={v.status} />
                <ResultBadge result={v.resultStatus} />
                {countsLabel && (
                  <span className="text-xs text-muted-foreground tabular-nums">{countsLabel}</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">{fmtTime(v.closedAt)}</span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
