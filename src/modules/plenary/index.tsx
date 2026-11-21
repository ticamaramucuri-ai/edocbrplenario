'use client'

/**
 * MÓDULO 1 — Mesa de Controle do Plenário (operação ao vivo da sessão).
 *
 * Fluxo: seletor de sessão → mesa (transições, quórum, tabs:
 * Presença | Pauta | Votação | Discursos | Telão).
 * Tempo real: eventos → invalidação de ['session', id] / ['sessions'] no
 * TanStack Query (a API é a fonte da verdade; o socket só sinaliza).
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Gavel, MapPin, RotateCcw, ShieldCheck, UserCog, Users, CalendarDays, ScrollText } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp, type ConnectionState } from '@/lib/store'
import { useRealtime } from '@/hooks/use-realtime'
import type { RealtimeEvent, SessionDetail } from '@/lib/contracts'
import { ConnectionBadge, QuorumBadge, SessionStatusBadge } from '@/components/app/badges'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fmtDateTime } from '@/lib/format'

import { SessionPicker } from './session-picker'
import { TransitionsBar } from './transitions-bar'
import { AttendanceTab } from './attendance-tab'
import { AgendaTab } from './agenda-tab'
import { VotingTab } from './voting-tab'
import { SpeechesTab } from './speeches-tab'
import { DisplayControlsTab } from './display-controls-tab'
import { TransmissionTab } from './transmission-tab'
import { sessionLabel } from './helpers'

export type PlenaryTab = 'presenca' | 'pauta' | 'votacao' | 'discursos' | 'telao' | 'transmissao'

export default function PlenaryModule() {
  const focusSessionId = useApp((s) => s.focusSessionId)
  const setFocusSession = useApp((s) => s.setFocusSession)
  const setDisplayFrozen = useApp((s) => s.setDisplayFrozen)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<PlenaryTab>('presenca')

  const sessionId = focusSessionId

  const invalidate = useCallback(() => {
    if (sessionId) void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    if (sessionId) void queryClient.invalidateQueries({ queryKey: ['transmission', sessionId] })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }, [queryClient, sessionId])

  // ─── Tempo real: qualquer evento da sessão em foco → invalidação ──────────
  useRealtime(
    useMemo(() => {
      const refresh = (event: RealtimeEvent) => {
        if (event.sessionId && sessionId && event.sessionId !== sessionId) return
        invalidate()
      }
      return {
        'session.state_changed': refresh,
        'session.quorum': refresh,
        'attendance.changed': refresh,
        'agenda.updated': refresh,
        'voting.created': refresh,
        'voting.state_changed': refresh,
        'vote.recorded': refresh,
        'voting.result': refresh,
        'speech.state_changed': refresh,
        'transmission.state_changed': refresh,
        'display.command': (event: RealtimeEvent) => {
          if (event.sessionId && sessionId && event.sessionId !== sessionId) return
          const payload = event.payload as { action?: string }
          if (payload?.action === 'freeze') setDisplayFrozen(true)
          if (payload?.action === 'unfreeze') setDisplayFrozen(false)
          if (sessionId) void queryClient.invalidateQueries({ queryKey: ['display-state', sessionId] })
        },
      }
    }, [invalidate, sessionId, setDisplayFrozen, queryClient])
  )

  if (!sessionId) return <SessionPicker />

  return (
    <Mesa
      sessionId={sessionId}
      tab={tab}
      onTabChange={setTab}
      invalidate={invalidate}
      onExit={() => setFocusSession(null)}
    />
  )
}

function Mesa({
  sessionId,
  tab,
  onTabChange,
  invalidate,
  onExit,
}: {
  sessionId: string
  tab: PlenaryTab
  onTabChange: (t: PlenaryTab) => void
  invalidate: () => void
  onExit: () => void
}) {
  const connection = useApp((s) => s.connection)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.getSession(sessionId),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={<Gavel />}
        title="Não foi possível carregar a sessão"
        description="A sessão pode ter sido removida ou o servidor está indisponível."
        action={
          <Button variant="outline" onClick={onExit}>
            <RotateCcw /> Escolher outra sessão
          </Button>
        }
      />
    )
  }

  return <MesaBody data={data} tab={tab} onTabChange={onTabChange} invalidate={invalidate} onExit={onExit} connection={connection} />
}

function PreflightBar({ sessionId, sessionStatus, onReleased }: { sessionId: string; sessionStatus: string; onReleased: () => void }) {
  const canTransition = useApp((s) => s.can('session.transition'))
  const qc = useQueryClient()
  const preflightQ = useQuery({
    queryKey: ['session-preflight', sessionId],
    queryFn: async () => {
      const headers: Record<string, string> = {}
      const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
      if (actorId) headers['x-actor-id'] = actorId
      const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/preflight`, { headers, credentials: 'same-origin' })
      if (!res.ok) throw new Error('Falha ao consultar pré-voo')
      return res.json() as Promise<{
        preflight: {
          agendaPublished: boolean
          agendaCount: number
          quorum: { present: number; required: number; ok: boolean }
          transferConfirmed: boolean
          designatedDesktop: { id: string; name: string } | null
          localAuthority: { active: boolean; epoch: number | null; deviceName: string | null }
          readyForWebOpen: boolean
          blockers: string[]
        }
      }>
    },
    enabled: ['scheduled', 'check_in', 'open', 'resumed'].includes(sessionStatus),
    refetchInterval: 20_000,
  })

  const release = useMutation({
    mutationFn: async (justification: string) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
      if (actorId) headers['x-actor-id'] = actorId
      const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/authority/release`, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ justification }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail || json.title || 'Erro ao liberar autoridade.')
      return json
    },
    onSuccess: () => {
      toast.success('Autoridade local liberada; operação web desbloqueada.')
      void qc.invalidateQueries({ queryKey: ['session-preflight', sessionId] })
      onReleased()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Erro ao liberar autoridade'),
  })

  const pf = preflightQ.data?.preflight
  if (!pf) return null
  const showFullPreflight = sessionStatus === 'scheduled' || sessionStatus === 'check_in'
  if (!showFullPreflight && !pf.localAuthority.active) return null

  return (
    <Card className={pf.localAuthority.active ? 'border-amber-500/50 bg-amber-500/5' : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 font-semibold">
            {pf.localAuthority.active ? (
              <AlertTriangle className="size-4 text-amber-600" />
            ) : pf.readyForWebOpen ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <ShieldCheck className="size-4 text-muted-foreground" />
            )}
            {pf.localAuthority.active
              ? `Sob autoridade local (${pf.localAuthority.deviceName ?? 'Desktop'} · época ${pf.localAuthority.epoch})`
              : 'Pré-voo da sessão'}
          </span>
          {showFullPreflight && (
            <>
              <span className={pf.agendaPublished && pf.agendaCount > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700'}>
                Pauta: {pf.agendaPublished ? `${pf.agendaCount} item(ns)` : 'não publicada'}
              </span>
              <span className={pf.quorum.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700'}>
                Quórum: {pf.quorum.present}/{pf.quorum.required}
              </span>
              {pf.designatedDesktop && (
                <span className={pf.transferConfirmed ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                  Desktop ({pf.designatedDesktop.name}): {pf.transferConfirmed ? 'manifesto OK' : 'pendente'}
                </span>
              )}
            </>
          )}
        </div>
        {pf.localAuthority.active && canTransition && (
          <Button
            size="sm"
            variant="outline"
            disabled={release.isPending}
            onClick={() => {
              const reason = window.prompt('Informe a justificativa para liberar a autoridade local (mín. 5 caracteres):')
              if (reason && reason.trim().length >= 5) release.mutate(reason.trim())
            }}
          >
            Liberar autoridade local
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function MesaBody({
  data,
  tab,
  onTabChange,
  invalidate,
  onExit,
  connection,
}: {
  data: SessionDetail
  tab: PlenaryTab
  onTabChange: (t: PlenaryTab) => void
  invalidate: () => void
  onExit: () => void
  connection: ConnectionState
}) {
  const { session, quorum } = data
  const canReadMedia = useApp((s) => s.can('media.read'))

  return (
    <div className="flex flex-col gap-4">
      <TransitionsBar session={session} invalidate={invalidate} />

      <PreflightBar sessionId={session.id} sessionStatus={session.status} onReleased={invalidate} />

      <PageHeader
        icon={<Gavel />}
        title="Mesa do Plenário"
        description={`${sessionLabel(session)} · ${session.location}`}
        actions={
          <>
            <SessionStatusBadge status={session.status} />
            <ConnectionBadge state={connection} />
            <Button variant="outline" size="sm" onClick={onExit}>
              <RotateCcw /> Trocar sessão
            </Button>
          </>
        }
      />

      {/* Sub-linha: composição da mesa + data/hora */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem icon={<UserCog className="size-3.5" />} label="Presidente" value={session.presidentName ?? '—'} />
          <InfoItem icon={<ScrollText className="size-3.5" />} label="Secretário" value={session.secretaryName ?? '—'} />
          <InfoItem icon={<MapPin className="size-3.5" />} label="Local" value={session.location} />
          <InfoItem
            icon={<CalendarDays className="size-3.5" />}
            label="Data e hora"
            value={`${fmtDateTime(session.scheduledAt)}${session.openedAt ? ` · aberta às ${fmtDateTime(session.openedAt)}` : ''}`}
          />
        </CardContent>
      </Card>

      {/* Barra de quórum */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <QuorumBadge present={quorum.present} required={quorum.required} ok={quorum.ok} />
              <span className="text-sm text-muted-foreground tabular-nums">
                {quorum.present} {quorum.present === 1 ? 'presente' : 'presentes'} de {quorum.total} parlamentares
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" aria-hidden /> Mínimo regimental: {quorum.required}
            </span>
          </div>
          <Progress
            value={(quorum.present / Math.max(1, quorum.total)) * 100}
            aria-label={`Presença: ${quorum.present} de ${quorum.total}`}
            className={quorum.ok ? '[&>div]:bg-emerald-600' : '[&>div]:bg-amber-600'}
          />
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as PlenaryTab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="presenca">Presença</TabsTrigger>
          <TabsTrigger value="pauta">Pauta</TabsTrigger>
          <TabsTrigger value="votacao">Votação</TabsTrigger>
          <TabsTrigger value="discursos">Discursos</TabsTrigger>
          <TabsTrigger value="telao">Telão</TabsTrigger>
          {canReadMedia && <TabsTrigger value="transmissao">Transmissão</TabsTrigger>}
        </TabsList>

        <TabsContent value="presenca" className="mt-4">
          <AttendanceTab data={data} invalidate={invalidate} />
        </TabsContent>
        <TabsContent value="pauta" className="mt-4">
          <AgendaTab data={data} invalidate={invalidate} onGoToVoting={() => onTabChange('votacao')} />
        </TabsContent>
        <TabsContent value="votacao" className="mt-4">
          <VotingTab data={data} invalidate={invalidate} />
        </TabsContent>
        <TabsContent value="discursos" className="mt-4">
          <SpeechesTab data={data} invalidate={invalidate} />
        </TabsContent>
        <TabsContent value="telao" className="mt-4">
          <DisplayControlsTab data={data} invalidate={invalidate} />
        </TabsContent>
        {canReadMedia && <TabsContent value="transmissao" className="mt-4">
          <TransmissionTab sessionId={session.id} />
        </TabsContent>}
      </Tabs>
    </div>
  )
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium" title={value}>
          {value}
        </p>
      </div>
    </div>
  )
}
