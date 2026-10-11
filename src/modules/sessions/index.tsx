'use client'

/**
 * Módulo Sessões — lista com filtros, transições da máquina de estados
 * (menu contextual por status, com confirmações para encerrar/cancelar),
 * criação de sessão e expansão de pauta on-demand.
 */
import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarCheck2,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Gavel,
  Lock,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Users,
  XCircle,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import {
  SESSION_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  type SessionStatus,
  type SessionSummary,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { SessionStatusBadge, SessionTypeBadge } from '@/components/app/badges'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AgendaPanel } from '@/modules/sessions/agenda-panel'
import { NewSessionDialog } from '@/modules/sessions/new-session-dialog'
import { EditSessionDialog } from '@/modules/sessions/edit-session-dialog'

const ALL_STATUSES = Object.keys(SESSION_STATUS_LABEL) as SessionStatus[]

function institutionalTime(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(iso))
  } catch {
    return fmtDateTime(iso)
  }
}

type TransitionDef = {
  action: string
  label: string
  icon: React.ReactNode
  confirm?: 'schedule' | 'close' | 'cancel'
  destructive?: boolean
}

const TRANSITIONS: Record<SessionStatus, TransitionDef[]> = {
  draft: [{ action: 'schedule', label: 'Agendar e publicar pauta', icon: <CalendarCheck2 />, confirm: 'schedule' }],
  scheduled: [{ action: 'open_checkin', label: 'Abrir credenciamento', icon: <DoorOpen /> }],
  check_in: [{ action: 'open_session', label: 'Abrir sessão', icon: <PlayCircle /> }],
  open: [
    { action: 'suspend', label: 'Suspender', icon: <PauseCircle /> },
    { action: 'close', label: 'Encerrar', icon: <Lock />, confirm: 'close' },
  ],
  suspended: [
    { action: 'resume', label: 'Retomar', icon: <PlayCircle /> },
    { action: 'close', label: 'Encerrar', icon: <Lock />, confirm: 'close' },
  ],
  resumed: [
    { action: 'suspend', label: 'Suspender', icon: <PauseCircle /> },
    { action: 'close', label: 'Encerrar', icon: <Lock />, confirm: 'close' },
  ],
  closed: [],
  cancelled: [],
}

const CANCELABLE: SessionStatus[] = ['draft', 'scheduled', 'check_in']

const SUCCESS_MESSAGE: Record<string, string> = {
  schedule: 'Pauta publicada e sessão agendada',
  open_checkin: 'Credenciamento aberto',
  open_session: 'Sessão aberta',
  suspend: 'Sessão suspensa',
  resume: 'Sessão retomada',
  close: 'Sessão encerrada',
  cancel: 'Sessão cancelada',
}

export default function SessionsModule() {
  const can = useApp((s) => s.can)
  const setModule = useApp((s) => s.setModule)
  const setFocusSession = useApp((s) => s.setFocusSession)
  const queryClient = useQueryClient()

  const canTransition = can('session.transition')
  const canCreate = can('session.create')

  const { data, isLoading } = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions() })
  const { data: noticeCalendar } = useQuery({ queryKey: ['notice-calendar'], queryFn: () => api.noticeCalendar(),
    enabled: canTransition, refetchInterval: 60_000 })

  const [statusFilter, setStatusFilter] = useState('todas')
  const [numberSearch, setNumberSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newDialogKey, setNewDialogKey] = useState(0)
  const [editTarget, setEditTarget] = useState<SessionSummary | null>(null)
  const [closeTarget, setCloseTarget] = useState<SessionSummary | null>(null)
  const [publishTarget, setPublishTarget] = useState<SessionSummary | null>(null)
  const [noticeExceptionReason, setNoticeExceptionReason] = useState('')
  const [cancelTarget, setCancelTarget] = useState<SessionSummary | null>(null)
  const [cancelJustification, setCancelJustification] = useState('')

  const sessions = data?.sessions ?? []
  const filtered = useMemo(() => {
    const q = numberSearch.trim()
    return sessions.filter((s) => {
      if (statusFilter !== 'todas' && s.status !== statusFilter) return false
      if (q && !`${s.number}/${s.year}`.includes(q) && !String(s.number).includes(q)) return false
      return true
    })
  }, [sessions, statusFilter, numberSearch])

  const transition = useMutation({
    mutationFn: ({
      session,
      action,
      justification,
      exceptionReason,
    }: {
      session: SessionSummary
      action: string
      justification?: string
      exceptionReason?: string
    }) => api.transitionSession(session.id, action, session.version, justification, exceptionReason),
    onSuccess: (_d, vars) => {
      toast.success(SUCCESS_MESSAGE[vars.action] ?? 'Sessão atualizada', {
        description: `${SESSION_TYPE_LABEL[vars.session.type]} nº ${vars.session.number}/${vars.session.year}`,
      })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['notice-calendar'] })
      queryClient.invalidateQueries({ queryKey: ['session', vars.session.id] })
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      setCloseTarget(null)
      setPublishTarget(null)
      setNoticeExceptionReason('')
      setCancelTarget(null)
      setCancelJustification('')
    },
    onError: () => {
      // Conflito de versão ou transição inválida → recarrega a lista
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  const runTransition = (session: SessionSummary, def: TransitionDef) => {
    if (def.confirm === 'schedule') {
      setNoticeExceptionReason('')
      setPublishTarget(session)
      return
    }
    if (def.confirm === 'close') {
      setCloseTarget(session)
      return
    }
    if (def.confirm === 'cancel') {
      setCancelJustification('')
      setCancelTarget(session)
      return
    }
    transition.mutate({ session, action: def.action })
  }

  const conduct = (s: SessionSummary) => {
    setFocusSession(s.id)
    setModule('plenary')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sessões"
        description="Ciclo de vida das sessões: rascunho, agendamento, credenciamento, condução e encerramento."
        icon={<CalendarClock />}
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setNewDialogKey((k) => k + 1)
                setNewDialogOpen(true)
              }}
            >
              <CalendarPlus /> Nova sessão
            </Button>
          ) : undefined
        }
      />

      {canTransition && noticeCalendar && <section className="rounded-lg border bg-card p-4" aria-label="Prazos de convocação">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Prazos de convocação e retificação</h2>
          <span className="text-xs text-muted-foreground">Horário da Câmara: {noticeCalendar.timezone}</span>
        </div>
        {noticeCalendar.rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma sessão futura em preparação.</p> :
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {noticeCalendar.rows.slice(0, 6).map((row) => <li key={row.sessionId} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{SESSION_TYPE_LABEL[row.type]} nº {row.number}/{row.year}</p>
              <p className="text-muted-foreground">{row.phase === 'initial' ? 'Publicar convocação' : 'Retificar pauta'} até {institutionalTime(row.deadlineAt, noticeCalendar.timezone)}</p>
              <p className={row.state === 'passed' ? 'font-medium text-destructive' : row.state === 'due_soon' ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                {row.state === 'passed' ? 'Prazo vencido' : row.state === 'due_soon' ? 'Vence em até 24 horas' : 'Dentro do prazo'}
                {row.state === 'passed' ? row.exceptionAllowed ? ' · exceção justificável' : ' · exceção indisponível' : ''}
              </p>
            </li>)}
          </ul>}
      </section>}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtros de sessões">
        <div className="grid gap-1.5">
          <Label htmlFor="session-status-filter" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="session-status-filter" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SESSION_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid flex-1 gap-1.5 sm:max-w-56">
          <Label htmlFor="session-number-search" className="text-xs text-muted-foreground">
            Buscar por número
          </Label>
          <Input
            id="session-number-search"
            value={numberSearch}
            onChange={(e) => setNumberSearch(e.target.value)}
            placeholder="Ex.: 2 ou 2/2026"
            className="h-9"
            inputMode="numeric"
          />
        </div>
        <p className="ml-auto self-center text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {filtered.length} de {sessions.length} sessões
        </p>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="Nenhuma sessão encontrada"
          description={
            sessions.length === 0
              ? 'Cadastre a primeira sessão do ano legislativo.'
              : 'Ajuste o filtro de status ou a busca por número.'
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" aria-label="Expandir pauta" />
                <TableHead scope="col">Nº / Ano</TableHead>
                <TableHead scope="col">Tipo</TableHead>
                <TableHead scope="col">Data e hora</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Presidente</TableHead>
                <TableHead scope="col">Presentes</TableHead>
                <TableHead scope="col">Pauta</TableHead>
                <TableHead scope="col" className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const expanded = expandedId === s.id
                return (
                  <Fragment key={s.id}>
                    <TableRow>
                      <TableCell className="text-muted-foreground">
                        <button
                          type="button"
                          aria-label={expanded ? `Recolher pauta da sessão ${s.number}/${s.year}` : `Expandir pauta da sessão ${s.number}/${s.year}`}
                          aria-expanded={expanded}
                          className="rounded p-1 focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setExpandedId(expanded ? null : s.id)}
                        >
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="font-bold tabular-nums">
                        {s.number}/{s.year}
                      </TableCell>
                      <TableCell>
                        <SessionTypeBadge type={s.type} />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{fmtDateTime(s.scheduledAt)}</TableCell>
                      <TableCell>
                        <SessionStatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm">{s.presidentName ?? '—'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
                          <Users className="size-3.5 text-muted-foreground" aria-hidden />
                          {s.presentCount}/{s.totalMembers}
                          <span className="sr-only">parlamentares presentes</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
                          {s.agendaCount} itens
                          {!s.agendaPublished && (
                            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              (não publicada)
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`Ações da sessão ${s.number}/${s.year}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>
                              {SESSION_TYPE_LABEL[s.type]} nº {s.number}/{s.year}
                            </DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => conduct(s)}>
                              <Gavel /> Conduzir na mesa
                            </DropdownMenuItem>
                            {canCreate && s.status === 'draft' && <DropdownMenuItem onClick={() => setEditTarget(s)}>
                              <Pencil /> Editar rascunho
                            </DropdownMenuItem>}
                            {canTransition && TRANSITIONS[s.status].length > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                {TRANSITIONS[s.status].map((def) => (
                                  <DropdownMenuItem
                                    key={def.action}
                                    onClick={() => runTransition(s, def)}
                                    disabled={transition.isPending}
                                    variant={def.destructive ? 'destructive' : 'default'}
                                  >
                                    {def.icon} {def.label}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                            {canTransition && CANCELABLE.includes(s.status) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={transition.isPending}
                                  onClick={() =>
                                    runTransition(s, {
                                      action: 'cancel',
                                      label: 'Cancelar sessão',
                                      icon: <XCircle />,
                                      confirm: 'cancel',
                                    })
                                  }
                                >
                                  <XCircle /> Cancelar sessão
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={9} className="whitespace-normal">
                          <AgendaPanel sessionId={s.id} sessionStatus={s.status} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Nova sessão (remonta a cada abertura para estado limpo) */}
      <NewSessionDialog key={newDialogKey} open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      {editTarget && <EditSessionDialog key={`${editTarget.id}-${editTarget.version}`} session={editTarget} onClose={() => setEditTarget(null)} />}

      {/* Publicação é uma ação distinta do salvamento do rascunho. */}
      <AlertDialog open={!!publishTarget} onOpenChange={(v) => !v && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Agendar e publicar a pauta?</AlertDialogTitle>
            <AlertDialogDescription>
              {publishTarget && `${SESSION_TYPE_LABEL[publishTarget.type]} nº ${publishTarget.number}/${publishTarget.year}, marcada para ${fmtDateTime(publishTarget.scheduledAt)}, terá seus ${publishTarget.agendaCount} itens publicados. Confira a pauta antes de confirmar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="publish-exception-reason">Justificativa para exceção de prazo (somente se necessária)</Label>
            <Textarea id="publish-exception-reason" value={noticeExceptionReason}
              onChange={(event) => setNoticeExceptionReason(event.target.value)} rows={2}
              placeholder="Preencha apenas se o prazo mínimo não for atendido e este tipo de sessão admitir urgência." />
            <p className="text-xs text-muted-foreground">A exceção será publicada na convocação. O servidor verifica a política desta Câmara.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar revisando</AlertDialogCancel>
            <AlertDialogAction
              disabled={transition.isPending || (noticeExceptionReason.trim().length > 0 && noticeExceptionReason.trim().length < 3)}
              onClick={() => publishTarget && transition.mutate({ session: publishTarget, action: 'schedule', exceptionReason: noticeExceptionReason.trim() || undefined })}
            >
              <CalendarCheck2 className="size-4" /> Publicar pauta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar encerramento */}
      <AlertDialog open={!!closeTarget} onOpenChange={(v) => !v && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar a sessão?</AlertDialogTitle>
            <AlertDialogDescription>
              {closeTarget &&
                `${SESSION_TYPE_LABEL[closeTarget.type]} nº ${closeTarget.number}/${closeTarget.year} será encerrada. Encerramento é irreversível — o espelho da sessão fica disponível em Relatórios.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter sessão</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeTarget && transition.mutate({ session: closeTarget, action: 'close' })}
            >
              <Lock className="size-4" /> Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelar com justificativa */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a sessão?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget &&
                `${SESSION_TYPE_LABEL[cancelTarget.type]} nº ${cancelTarget.number}/${cancelTarget.year} será cancelada com registro em auditoria. A justificativa é obrigatória.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-justification">Justificativa *</Label>
            <Textarea
              id="cancel-justification"
              value={cancelJustification}
              onChange={(e) => setCancelJustification(e.target.value)}
              placeholder="Ex.: falta de quórum para abrir os trabalhos."
              rows={3}
              aria-required="true"
            />
            {cancelJustification.trim().length > 0 && cancelJustification.trim().length < 3 && (
              <p className="text-xs text-destructive">Mínimo de 3 caracteres.</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter sessão</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelJustification.trim().length < 3 || transition.isPending}
              onClick={() =>
                cancelTarget &&
                transition.mutate({
                  session: cancelTarget,
                  action: 'cancel',
                  justification: cancelJustification.trim(),
                })
              }
            >
              <XCircle className="size-4" /> Cancelar sessão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
