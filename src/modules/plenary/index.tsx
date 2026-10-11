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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gavel, MapPin, RotateCcw, UserCog, Users, CalendarDays, ScrollText } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
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
          const payload = event.payload as { action?: string }
          if (payload?.action === 'freeze') setDisplayFrozen(true)
          if (payload?.action === 'unfreeze') setDisplayFrozen(false)
        },
      }
    }, [invalidate, sessionId, setDisplayFrozen])
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
  connection: 'connecting' | 'online' | 'reconnecting' | 'offline'
}) {
  const { session, quorum } = data
  const canReadMedia = useApp((s) => s.can('media.read'))

  return (
    <div className="flex flex-col gap-4">
      <TransitionsBar session={session} invalidate={invalidate} />

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
