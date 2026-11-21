'use client'

/**
 * Tab Discursos — inscrição de oradores, fila de espera e o “palco” com
 * cronômetro grande, controles (iniciar/pausar/retomar/+1min/encerrar),
 * alertas sonoros regimentais e mute local.
 */

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Clock,
  Mic,
  PauseCircle,
  PlayCircle,
  Plus,
  Timer,
  UserRound,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { SessionDetail, SpeechView } from '@/lib/contracts'
import { SPEECH_KIND_LABEL } from '@/lib/contracts'
import { fmtDuration } from '@/lib/format'
import { EmptyState } from '@/components/app/page-header'
import { PartyBadge } from '@/components/app/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { cn } from '@/lib/utils'
import { useNow, playBeep } from './timer'
import { SPEECH_STATUSES, speechStage } from './helpers'

type Props = { data: SessionDetail; invalidate: () => void }

const KINDS = Object.keys(SPEECH_KIND_LABEL)

export function SpeechesTab({ data, invalidate }: Props) {
  const canWrite = useApp((s) => s.can('speech.write'))
  const [enqueueOpen, setEnqueueOpen] = useState(false)

  const stage = speechStage(data.speeches)
  const queue = data.speeches.filter((s) => s.status === 'fila')
  const done = data.speeches.filter((s) => s.status === 'encerrado')
  const enqueueAllowed = SPEECH_STATUSES.includes(data.session.status)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? 'Fila vazia'
            : `${queue.length} ${queue.length === 1 ? 'orador na fila' : 'oradores na fila'}`}
          {done.length > 0 && ` · ${done.length} encerrado(s)`}
        </p>
        <Button size="sm" onClick={() => setEnqueueOpen(true)} disabled={!canWrite || !enqueueAllowed}>
          <Plus /> Inscrever orador
        </Button>
      </div>

      {!enqueueAllowed && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Discursos podem ser enfileirados com a sessão em credenciamento, aberta, suspensa ou
          retomada.
        </p>
      )}

      {stage ? (
        <SpeechStage speech={stage} invalidate={invalidate} canWrite={canWrite} />
      ) : queue.length > 0 ? (
        <NextSpeakerPanel speech={queue[0]} canWrite={canWrite} invalidate={invalidate} />
      ) : (
        <EmptyState
          icon={<Mic />}
          title="Nenhum orador no palco"
          description="Inscreva oradores para o grande expediente, explicações pessoais, homenagens e questões de ordem."
        />
      )}

      {queue.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Fila de oradores</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {queue.map((s, i) => (
              <SpeechRow
                key={s.id}
                speech={s}
                position={i + 1}
                attendance={data.attendance}
                canWrite={canWrite}
                invalidate={invalidate}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {done.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-muted-foreground">Discursos encerrados</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {done.map((s) => (
              <SpeechRow key={s.id} speech={s} attendance={data.attendance} done />
            ))}
          </CardContent>
        </Card>
      )}

      <EnqueueDialog
        open={enqueueOpen}
        onOpenChange={setEnqueueOpen}
        sessionId={data.session.id}
        attendance={data.attendance}
        invalidate={invalidate}
      />
    </div>
  )
}

// ─── Palco (orador em andamento) ───────────────────────────────────────────

function SpeechStage({
  speech,
  invalidate,
  canWrite,
}: {
  speech: SpeechView
  invalidate: () => void
  canWrite: boolean
}) {
  const soundAlerts = useApp((s) => s.bootstrap?.tenant.settings.soundAlerts ?? true)
  const [muted, setMuted] = useState(false)
  const now = useNow(1000, true)
  const beeped = useRef<Set<string>>(new Set())

  const transition = useMutation({
    mutationFn: (vars: { action: string; seconds?: number; success: string }) =>
      api.transitionSpeech(speech.id, vars.action, vars.seconds),
    onSuccess: (_r, vars) => {
      invalidate()
      toast.success(vars.success)
    },
  })

  useEffect(() => {
    beeped.current = new Set()
  }, [speech.id])

  const elapsed =
    speech.elapsedSeconds +
    (speech.status === 'falando' && speech.startedAt
      ? Math.max(0, Math.floor((now - new Date(speech.startedAt).getTime()) / 1000))
      : 0)
  const planned = Math.max(1, speech.plannedSeconds)
  const remaining = planned - elapsed
  const over = elapsed > planned
  const warn = !over && remaining <= 30

  // Alertas sonoros: 30s restantes, 10s restantes e ao atingir o tempo.
  useEffect(() => {
    if (!soundAlerts || muted) return
    const mark = (key: string) => {
      if (beeped.current.has(key)) return
      beeped.current.add(key)
      playBeep()
    }
    if (elapsed >= planned) mark('zero')
    else if (remaining <= 10) mark('ten')
    else if (remaining <= 30) mark('thirty')
  }, [elapsed, planned, remaining, soundAlerts, muted])

  const timerColor = over
    ? 'animate-pulse text-rose-600 dark:text-rose-400'
    : warn
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground'

  return (
    <Card className="border-primary/25">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
              <Mic className="size-4" /> Com a palavra
            </p>
            <CardTitle className="mt-1 text-2xl font-bold leading-tight">{speech.speakerName}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{SPEECH_KIND_LABEL[speech.kind] ?? speech.kind}</Badge>
              <SpeechStatusBadge status={speech.status} />
              {speech.subject && (
                <span className="text-sm text-muted-foreground">{speech.subject}</span>
              )}
            </div>
          </div>

          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              {speech.status === 'falando' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => transition.mutate({ action: 'pause', success: 'Discurso pausado' })}
                  disabled={transition.isPending}
                >
                  <PauseCircle /> Pausar
                </Button>
              )}
              {speech.status === 'pausado' && (
                <Button
                  size="sm"
                  onClick={() => transition.mutate({ action: 'resume', success: 'Discurso retomado' })}
                  disabled={transition.isPending}
                >
                  <PlayCircle /> Retomar
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => transition.mutate({ action: 'extend', seconds: 60, success: 'Tempo prorrogado em 1 minuto' })}
                disabled={transition.isPending}
              >
                <Timer /> +1 min
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={transition.isPending}>
                    Encerrar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Encerrar o discurso?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Encerra o discurso de {speech.speakerName} com {fmtDuration(elapsed)} de
                      tribuna.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={transition.isPending}
                      onClick={(e) => {
                        e.preventDefault()
                        transition.mutate({ action: 'finish', success: 'Discurso encerrado' })
                      }}
                    >
                      Encerrar discurso
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {soundAlerts && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setMuted((v) => !v)}
                  aria-label={muted ? 'Ativar alertas sonoros' : 'Silenciar alertas sonoros'}
                  title={muted ? 'Ativar alertas sonoros' : 'Silenciar alertas sonoros'}
                >
                  {muted ? <VolumeX /> : <Volume2 />}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col items-center gap-3 pb-6 pt-2">
        <p
          className={cn('font-mono text-6xl font-bold tabular-nums tracking-tight sm:text-7xl', timerColor)}
          role="timer"
          aria-label={`Tempo de tribuna: ${fmtDuration(elapsed)}`}
        >
          {fmtDuration(elapsed)}
        </p>
        <p className={cn('text-sm font-medium', over ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
          {over
            ? `Tempo excedido em ${fmtDuration(elapsed - planned)}`
            : `${fmtDuration(remaining)} restantes de ${fmtDuration(planned)}`}
        </p>
        <Progress
          value={Math.min(100, (elapsed / planned) * 100)}
          aria-label={`Progresso do discurso: ${fmtDuration(elapsed)} de ${fmtDuration(planned)}`}
          className="w-full max-w-xl [&>div]:bg-emerald-600 data-[over=true]:[&>div]:bg-rose-600"
        />
      </CardContent>
    </Card>
  )
}

function NextSpeakerPanel({
  speech,
  canWrite,
  invalidate,
}: {
  speech: SpeechView
  canWrite: boolean
  invalidate: () => void
}) {
  const transition = useMutation({
    mutationFn: (vars: { action: string; success: string }) =>
      api.transitionSpeech(speech.id, vars.action),
    onSuccess: (_r, vars) => {
      invalidate()
      toast.success(vars.success)
    },
  })

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Próximo orador: {speech.speakerName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {SPEECH_KIND_LABEL[speech.kind] ?? speech.kind}
            {speech.subject ? ` · ${speech.subject}` : ''} · {fmtDuration(speech.plannedSeconds)} de
            tribuna
          </p>
        </div>
        <Button
          onClick={() => transition.mutate({ action: 'start', success: `${speech.speakerName} está com a palavra` })}
          disabled={!canWrite || transition.isPending}
        >
          <PlayCircle /> Iniciar
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Linha da fila ─────────────────────────────────────────────────────────

function SpeechRow({
  speech,
  position,
  attendance,
  done = false,
  canWrite = false,
  invalidate,
}: {
  speech: SpeechView
  position?: number
  attendance: SessionDetail['attendance']
  done?: boolean
  canWrite?: boolean
  invalidate?: () => void
}) {
  const member = attendance.find((a) => a.parliamentarianId === speech.parliamentarianId)
  const cancel = useMutation({
    mutationFn: () => api.transitionSpeech(speech.id, 'cancel'),
    onSuccess: () => {
      invalidate?.()
      toast.success(`Inscrição de ${speech.speakerName} cancelada`)
    },
  })
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3.5', done && 'opacity-70')}>
      {position && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums">
          {position}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-semibold', done && 'line-through decoration-muted-foreground/50')}>
          {speech.speakerName}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{SPEECH_KIND_LABEL[speech.kind] ?? speech.kind}</span>
          {speech.subject && <span className="truncate">· {speech.subject}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {member ? (
          <PartyBadge party={member.party} bloc={member.bloc} />
        ) : (
          <Badge variant="outline">
            <UserRound className="size-3" /> Convidado/Externo
          </Badge>
        )}
        {speech.side && <SideBadge side={speech.side} />}
        <SpeechStatusBadge status={speech.status} />
        <span className="text-xs text-muted-foreground tabular-nums">{fmtDuration(speech.plannedSeconds)}</span>
        {!done && speech.status === 'fila' && canWrite && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
            aria-label={`Cancelar inscrição de ${speech.speakerName}`}
            title="Cancelar inscrição na fila"
          >
            <XCircle className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function SideBadge({ side }: { side: 'situacao' | 'oposicao' | 'neutro' }) {
  if (side === 'situacao')
    return <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">Situação</Badge>
  if (side === 'oposicao')
    return <Badge className="bg-amber-700 text-white hover:bg-amber-700">Oposição</Badge>
  return <Badge variant="outline">Neutro</Badge>
}

function SpeechStatusBadge({ status }: { status: SpeechView['status'] }) {
  const map: Record<SpeechView['status'], { variant: 'default' | 'secondary' | 'outline'; icon: React.ReactNode; label: string }> = {
    fila: { variant: 'secondary', icon: <Clock />, label: 'Na fila' },
    falando: { variant: 'default', icon: <Mic />, label: 'Falando' },
    pausado: { variant: 'outline', icon: <PauseCircle />, label: 'Pausado' },
    encerrado: { variant: 'outline', icon: <CheckCircle2 />, label: 'Encerrado' },
  }
  const { variant, icon, label } = map[status]
  return (
    <Badge variant={variant} className={cn(status === 'falando' && 'bg-emerald-700 text-white hover:bg-emerald-700')}>
      {icon} {label}
    </Badge>
  )
}

// ─── Dialog de inscrição ───────────────────────────────────────────────────

function EnqueueDialog({
  open,
  onOpenChange,
  sessionId,
  attendance,
  invalidate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  attendance: SessionDetail['attendance']
  invalidate: () => void
}) {
  const defaultSeconds = useApp((s) => s.bootstrap?.tenant.settings.speechDefaultSeconds ?? 300)
  const [speakerType, setSpeakerType] = useState<'parlamentar' | 'externo'>('parlamentar')
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [externalName, setExternalName] = useState('')
  const [kind, setKind] = useState(KINDS[0])
  const [subject, setSubject] = useState('')
  const [side, setSide] = useState('')
  const [seconds, setSeconds] = useState(300)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSpeakerType('parlamentar')
      setParliamentarianId('')
      setExternalName('')
      setKind(KINDS[0])
      setSubject('')
      setSide('')
      setSeconds(defaultSeconds)
    }
  }, [open, defaultSeconds])

  const valid =
    speakerType === 'parlamentar' ? !!parliamentarianId : externalName.trim().length >= 3

  const submit = async () => {
    setBusy(true)
    try {
      await api.enqueueSpeech(sessionId, {
        parliamentarianId: speakerType === 'parlamentar' ? parliamentarianId : undefined,
        externalSpeaker: speakerType === 'externo' ? externalName.trim() : undefined,
        kind,
        subject: subject.trim() || undefined,
        side: side || undefined,
        plannedSeconds: seconds > 0 ? seconds : undefined,
      })
      invalidate()
      toast.success('Orador inscrito na fila.')
      onOpenChange(false)
    } catch {
      // toast global
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="size-5 text-primary" /> Inscrever orador
          </DialogTitle>
          <DialogDescription>O orador entra no fim da fila de discursos.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Tipo de orador</legend>
            <RadioGroup
              value={speakerType}
              onValueChange={(v) => setSpeakerType(v as 'parlamentar' | 'externo')}
              className="grid grid-cols-2 gap-2"
            >
              <Label
                htmlFor="spk-parlamentar"
                className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition hover:bg-accent has-[button[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id="spk-parlamentar" value="parlamentar" />
                Parlamentar
              </Label>
              <Label
                htmlFor="spk-externo"
                className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition hover:bg-accent has-[button[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id="spk-externo" value="externo" />
                Convidado/Externo
              </Label>
            </RadioGroup>
          </fieldset>

          {speakerType === 'parlamentar' ? (
            <div className="grid gap-2">
              <Label htmlFor="spk-member">Parlamentar</Label>
              <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
                <SelectTrigger id="spk-member" className="w-full">
                  <SelectValue placeholder="Selecione o parlamentar…" />
                </SelectTrigger>
                <SelectContent>
                  {attendance.map((m) => (
                    <SelectItem key={m.parliamentarianId} value={m.parliamentarianId}>
                      {m.name} ({m.party})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="spk-external">Nome do orador</Label>
              <Input
                id="spk-external"
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                placeholder="Ex.: Secretário Municipal de Obras"
                maxLength={120}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="spk-kind">Tipo de discurso</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="spk-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {SPEECH_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="spk-side">Lado</Label>
              <Select value={side} onValueChange={setSide}>
                <SelectTrigger id="spk-side" className="w-full">
                  <SelectValue placeholder="Sem lado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="situacao">Situação</SelectItem>
                  <SelectItem value="oposicao">Oposição</SelectItem>
                  <SelectItem value="neutro">Neutro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="grid gap-2">
              <Label htmlFor="spk-subject">Assunto</Label>
              <Input
                id="spk-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Opcional"
                maxLength={200}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="spk-seconds">Duração (s)</Label>
              <Input
                id="spk-seconds"
                type="number"
                min={30}
                max={3600}
                value={seconds}
                onChange={(e) => setSeconds(Math.max(0, Number(e.target.value) || 0))}
                className="tabular-nums"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !valid}>
            {busy ? 'Inscrevendo…' : 'Inscrever na fila'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
