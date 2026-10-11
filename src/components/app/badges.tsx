/**
 * Badges de status — nunca dependem só de cor (ícone/texto sempre presentes).
 */
'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  AGENDA_STATUS_LABEL,
  ATTENDANCE_STATUS_LABEL,
  RESULT_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  VOTE_VALUE_LABEL,
  VOTING_MODE_LABEL,
  VOTING_STATUS_LABEL,
  type AgendaItemStatus,
  type AttendanceStatus,
  type SessionStatus,
  type SessionType,
  type VoteValueOrEmpty,
  type VotingMode,
  type VotingStatus,
} from '@/lib/contracts'
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  HelpCircle,
  Clock,
  PauseCircle,
  PlayCircle,
  CircleSlash,
  AlertTriangle,
  UserCheck,
  UserX,
  UserMinus,
  DoorOpen,
  CalendarCheck2,
  CalendarClock,
  Lock,
  CheckCheck,
  Equal,
  Gavel,
  Vote,
  MonitorPlay,
} from 'lucide-react'

const base =
  'inline-flex items-center gap-1 whitespace-nowrap font-medium [&_svg]:size-3'

export function SessionStatusBadge({ status, className }: { status: SessionStatus; className?: string }) {
  const map: Record<SessionStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
    draft: { variant: 'outline', icon: <PauseCircle /> },
    scheduled: { variant: 'secondary', icon: <CalendarClock /> },
    check_in: { variant: 'secondary', icon: <DoorOpen /> },
    open: { variant: 'default', icon: <PlayCircle className="text-emerald-600 dark:text-emerald-400" /> },
    suspended: { variant: 'outline', icon: <PauseCircle /> },
    resumed: { variant: 'default', icon: <PlayCircle className="text-emerald-600 dark:text-emerald-400" /> },
    closed: { variant: 'outline', icon: <Lock /> },
    cancelled: { variant: 'destructive', icon: <XCircle /> },
  }
  const { variant, icon } = map[status] ?? map.draft
  return (
    <Badge variant={variant} className={cn(base, className)}>
      {icon}
      {SESSION_STATUS_LABEL[status]}
    </Badge>
  )
}

export function SessionTypeBadge({ type }: { type: SessionType }) {
  return <Badge variant="outline" className={cn(base)}>{SESSION_TYPE_LABEL[type] ?? type}</Badge>
}

export function VotingStatusBadge({ status }: { status: VotingStatus }) {
  const map: Record<VotingStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
    draft: { variant: 'outline', icon: <PauseCircle /> },
    ready: { variant: 'secondary', icon: <Clock /> },
    open: { variant: 'default', icon: <Vote className="text-emerald-600 dark:text-emerald-400" /> },
    paused: { variant: 'outline', icon: <PauseCircle /> },
    closed: { variant: 'secondary', icon: <Lock /> },
    annulled: { variant: 'destructive', icon: <CircleSlash /> },
    cancelled: { variant: 'outline', icon: <CircleSlash /> },
  }
  const { variant, icon } = map[status] ?? map.draft
  return (
    <Badge variant={variant} className={cn(base)}>
      {icon}
      {VOTING_STATUS_LABEL[status]}
    </Badge>
  )
}

export function VotingModeBadge({ mode }: { mode: VotingMode }) {
  const map: Record<VotingMode, string> = { nominal: 'Nominal', simbolico: 'Simbólica', secreto: 'Secreta' }
  return (
    <Badge variant="outline" className={cn(base)}>
      <Gavel />
      {map[mode] ?? VOTING_MODE_LABEL[mode]}
    </Badge>
  )
}

export function AgendaStatusBadge({ status }: { status: AgendaItemStatus }) {
  const map: Record<AgendaItemStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
    pendente: { variant: 'outline', icon: <Clock /> },
    em_leitura: { variant: 'secondary', icon: <MonitorPlay /> },
    em_discussao: { variant: 'secondary', icon: <HelpCircle /> },
    em_votacao: { variant: 'default', icon: <Vote className="text-emerald-600 dark:text-emerald-400" /> },
    aprovado: { variant: 'default', icon: <CheckCheck className="text-emerald-600 dark:text-emerald-400" /> },
    rejeitado: { variant: 'destructive', icon: <XCircle /> },
    retirado: { variant: 'outline', icon: <CircleSlash /> },
    adiado: { variant: 'outline', icon: <CalendarClock /> },
  }
  const { variant, icon } = map[status] ?? map.pendente
  return (
    <Badge variant={variant} className={cn(base)}>
      {icon}
      {AGENDA_STATUS_LABEL[status]}
    </Badge>
  )
}

export function VoteValueBadge({ value }: { value: VoteValueOrEmpty }) {
  if (value === 'sim')
    return (
      <Badge className={cn(base, 'bg-emerald-600 hover:bg-emerald-600 text-white')}>
        <CheckCircle2 /> Sim
      </Badge>
    )
  if (value === 'nao')
    return (
      <Badge className={cn(base, 'bg-rose-600 hover:bg-rose-600 text-white')}>
        <XCircle /> Não
      </Badge>
    )
  if (value === 'abstencao')
    return (
      <Badge className={cn(base, 'bg-amber-600 hover:bg-amber-600 text-white')}>
        <MinusCircle /> {VOTE_VALUE_LABEL.abstencao}
      </Badge>
    )
  return (
    <Badge variant="outline" className={cn(base, 'text-muted-foreground')}>
      <HelpCircle /> {VOTE_VALUE_LABEL.nao_registrado}
    </Badge>
  )
}

export function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-muted-foreground">—</span>
  if (result === 'aprovado')
    return (
      <Badge className={cn(base, 'bg-emerald-600 hover:bg-emerald-600 text-white')}>
        <CheckCircle2 /> {RESULT_STATUS_LABEL.aprovado}
      </Badge>
    )
  if (result === 'rejeitado')
    return (
      <Badge className={cn(base, 'bg-rose-600 hover:bg-rose-600 text-white')}>
        <XCircle /> {RESULT_STATUS_LABEL.rejeitado}
      </Badge>
    )
  if (result === 'empate')
    return (
      <Badge className={cn(base, 'bg-amber-600 hover:bg-amber-600 text-white')}>
        <Equal /> {RESULT_STATUS_LABEL.empate}
      </Badge>
    )
  if (result === 'sem_quorum')
    return (
      <Badge className={cn(base, 'bg-zinc-600 hover:bg-zinc-600 text-white')}>
        <AlertTriangle /> {RESULT_STATUS_LABEL.sem_quorum}
      </Badge>
    )
  return (
    <Badge variant="destructive" className={cn(base)}>
      <CircleSlash /> {RESULT_STATUS_LABEL.anulado}
    </Badge>
  )
}

export function PresenceBadge({ status }: { status: AttendanceStatus }) {
  const map: Record<AttendanceStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
    presente: { variant: 'default', icon: <UserCheck /> },
    saida_temporaria: { variant: 'secondary', icon: <DoorOpen /> },
    licenciado: { variant: 'outline', icon: <UserMinus /> },
    afastado: { variant: 'outline', icon: <UserMinus /> },
    ausente: { variant: 'destructive', icon: <UserX /> },
  }
  const { variant, icon } = map[status]
  return (
    <Badge
      variant={variant}
      className={cn(base, status === 'presente' && 'bg-emerald-600 hover:bg-emerald-600 text-white')}
    >
      {icon}
      {ATTENDANCE_STATUS_LABEL[status]}
    </Badge>
  )
}

export function PartyBadge({ party, bloc }: { party: string; bloc?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className="font-mono text-[11px]">
        {party}
      </Badge>
      {bloc && (
        <span
          className={cn(
            'text-[11px] font-medium',
            bloc === 'Situação' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
          )}
        >
          {bloc}
        </span>
      )}
    </span>
  )
}

export function ConnectionBadge({ state }: { state: 'connecting' | 'online' | 'reconnecting' | 'offline' }) {
  const map = {
    online: { label: 'Tempo real', dot: 'bg-emerald-500', pulse: true },
    connecting: { label: 'Conectando…', dot: 'bg-amber-500', pulse: true },
    reconnecting: { label: 'Reconectando…', dot: 'bg-amber-500', pulse: true },
    offline: { label: 'Offline', dot: 'bg-rose-500', pulse: false },
  }[state]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground" role="status" aria-label={`Status de conexão: ${map.label}`}>
      <span className={cn('relative flex size-2', map.pulse && 'animate-pulse')}>
        <span className={cn('absolute inline-flex size-full rounded-full opacity-60', map.dot)} />
      </span>
      {map.label}
    </span>
  )
}

export function QuorumBadge({ present, required, ok }: { present: number; required: number; ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums',
        ok ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
      )}
      title={`Quórum necessário: ${required}`}
    >
      <UserCheck className="size-3" aria-hidden />
      Quórum {present}/{required}
      <span className="sr-only">{ok ? 'quórum atingido' : 'quórum insuficiente'}</span>
    </span>
  )
}

export { CalendarCheck2 }
