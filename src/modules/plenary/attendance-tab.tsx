'use client'

/**
 * Tab Presença — grid de parlamentares com ações rápidas de presença,
 * check-in em lote e alerta de quórum.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, DoorOpen, ListChecks, LogIn, MoreHorizontal, Undo2, UserCheck, UserMinus, UserX } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { AttendanceRow, SessionDetail } from '@/lib/contracts'
import { ATTENDANCE_STATUS_LABEL, BOARD_ROLE_LABEL } from '@/lib/contracts'
import { fmtTime, initials } from '@/lib/format'
import { PartyBadge, PresenceBadge } from '@/components/app/badges'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { attendanceLiveAllowed, attendanceMarkAllowed, LIVE_SESSION_STATUSES } from './helpers'

type Props = { data: SessionDetail; invalidate: () => void }

type QuickAction = { action: string; label: string; icon: typeof LogIn; success: string }

function quickActionFor(m: AttendanceRow): QuickAction | null {
  if (m.status === 'presente')
    return { action: 'check_out', label: 'Saída temporária', icon: DoorOpen, success: `${m.name}: saída temporária` }
  if (m.status === 'saida_temporaria')
    return { action: 'return', label: 'Retornou ao plenário', icon: Undo2, success: `${m.name}: retornou` }
  return { action: 'check_in', label: 'Registrar check-in', icon: LogIn, success: `${m.name}: presente` }
}

function avatarClass(bloc: string | null): string {
  if (bloc === 'Situação') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  if (bloc === 'Oposição') return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
}

export function AttendanceTab({ data, invalidate }: Props) {
  const canWrite = useApp((s) => s.can('attendance.write'))
  const status = data.session.status
  const liveOk = attendanceLiveAllowed(status)
  const markOk = attendanceMarkAllowed(status)
  const [bulkBusy, setBulkBusy] = useState(false)

  const mutate = useMutation({
    mutationFn: (vars: { pid: string; action: string }) =>
      api.attendance(data.session.id, vars.pid, vars.action),
    onSuccess: (result, vars) => {
      invalidate()
      const m = data.attendance.find((a) => a.parliamentarianId === vars.pid)
      toast.success(`${m?.name ?? 'Parlamentar'}: ${ATTENDANCE_STATUS_LABEL[result.attendance.status]}`)
    },
  })

  const runBulk = async () => {
    const targets = data.attendance.filter((m) => m.status === 'ausente')
    if (targets.length === 0) {
      toast.info('Nenhum parlamentar ausente para check-in.')
      return
    }
    setBulkBusy(true)
    // Sequencial: evita contenção de escrita concorrente no SQLite
    let ok = 0
    for (const m of targets) {
      try {
        await api.attendance(data.session.id, m.parliamentarianId, 'check_in')
        ok += 1
      } catch {
        // erro individual já sinalizado pelo toast global; segue o lote
      }
    }
    invalidate()
    setBulkBusy(false)
    toast.success(`${ok} check-in(s) registrado(s)`, {
      description: ok < targets.length ? `${targets.length - ok} não puderam ser registrados.` : undefined,
    })
  }

  const quorumAlert =
    !data.quorum.ok && LIVE_SESSION_STATUSES.includes(status)

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex flex-col gap-4">
        {quorumAlert && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong>Quórum insuficiente para deliberar</strong> — {data.quorum.present} de{' '}
              {data.quorum.required} necessários. Registre presenças para habilitar a abertura de
              votações.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {data.attendance.length} parlamentares · {data.quorum.present} presentes ·{' '}
            {data.attendance.filter((m) => m.status === 'saida_temporaria').length} em saída temporária
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runBulk()}
            disabled={!canWrite || !liveOk || bulkBusy}
            title={liveOk ? 'Registra check-in de todos os ausentes' : 'Disponível com a sessão em credenciamento/aberta'}
          >
            <ListChecks /> {bulkBusy ? 'Registrando…' : 'Check-in de todos os ausentes'}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.attendance.map((m) => (
            <MemberCard
              key={m.parliamentarianId}
              member={m}
              canWrite={canWrite}
              liveOk={liveOk}
              markOk={markOk}
              busy={mutate.isPending && mutate.variables?.pid === m.parliamentarianId}
              onAction={(action) => mutate.mutate({ pid: m.parliamentarianId, action })}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}

function MemberCard({
  member,
  canWrite,
  liveOk,
  markOk,
  busy,
  onAction,
}: {
  member: AttendanceRow
  canWrite: boolean
  liveOk: boolean
  markOk: boolean
  busy: boolean
  onAction: (action: string) => void
}) {
  const quick = quickActionFor(member)
  const role = BOARD_ROLE_LABEL[member.boardRole] ?? member.boardRole
  const showRole = member.boardRole && member.boardRole !== 'vereador'

  return (
    <Card className="gap-0 transition" aria-label={`Presença de ${member.name}`}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10 border">
              <AvatarFallback className={cn('text-xs font-bold', avatarClass(member.bloc))}>
                {initials(member.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{member.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {showRole ? role : 'Vereador(a)'}
              </p>
            </div>
          </div>
          <PartyBadge party={member.party} bloc={member.bloc} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <PresenceBadge status={member.status} />
            {member.lastEventAt && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {fmtTime(member.lastEventAt)}
              </span>
            )}
          </div>

          {canWrite && (
            <div className="flex shrink-0 items-center gap-1">
              {quick && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      className="size-8"
                      variant="outline"
                      disabled={!liveOk || busy}
                      onClick={() => onAction(quick.action)}
                      aria-label={`${quick.label} — ${member.name}`}
                    >
                      <quick.icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{quick.label}</TooltipContent>
                </Tooltip>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    className="size-8"
                    variant="ghost"
                    disabled={!markOk}
                    aria-label={`Mais ações de presença para ${member.name}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Marcação manual</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onAction('mark_presente')} disabled={!markOk}>
                    <UserCheck /> Marcar presente
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction('mark_licenca')} disabled={!markOk}>
                    <UserMinus /> Marcar licenciado
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction('mark_afastado')} disabled={!markOk}>
                    <UserMinus /> Marcar afastado
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onAction('mark_ausente')} disabled={!markOk}>
                    <UserX /> Marcar ausente
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {!markOk && !liveOk && canWrite && (
          <p className="text-[11px] text-muted-foreground">
            Presença fechada para este status de sessão.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
