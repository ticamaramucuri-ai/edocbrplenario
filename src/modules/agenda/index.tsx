/**
 * Fase 13 — Agenda Legislativa (Task 22-a).
 * Grade mensal (date-fns, pt-BR, semana iniciando em domingo) agregando
 * sessões, audiências públicas, reuniões de comissão e prazos de tarefas
 * (GET /api/v1/calendar). Filtros por tipo (ícone + cor + texto), painel do
 * dia selecionado com ação "Ir para…" e seção de próximos eventos (7 dias).
 */
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Megaphone,
  RefreshCcw,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader, EmptyState } from '@/components/app/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useApp, type ModuleId } from '@/lib/store'
import {
  CALENDAR_KIND_LABEL,
  COMMITTEE_MEETING_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type CalendarEventKind,
  type CalendarEventView,
  type CalendarResponse,
} from '@/lib/contracts'

// ─── Fetch local (api-client.ts intocável — mesmo padrão de publications) ───

type Problem = { title?: string; detail?: string; status?: number; code?: string }

class AgendaApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title || 'Erro na requisição.')
    this.name = 'AgendaApiError'
  }
}

/** fetch + JSON + Problem Details; injeta x-actor-id do modo demo. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) throw new AgendaApiError((body ?? {}) as Problem)
  return body as T
}

function problemMessage(err: unknown): string {
  if (err instanceof AgendaApiError) return err.problem.detail || err.problem.title || 'Erro na requisição.'
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

// ─── Metadados por tipo de evento (ícone + cor + TEXTO — nunca só cor) ──────

type KindStyle = { icon: LucideIcon; chip: string; dot: string; badge: string; label: string }

const KIND_META: Record<CalendarEventKind, KindStyle> = {
  session: {
    icon: CalendarClock,
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    label: 'Sessão',
  },
  hearing: {
    icon: Megaphone,
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-600 dark:bg-amber-400',
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
    label: 'Audiência',
  },
  committee_meeting: {
    icon: Users,
    chip: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
    dot: 'bg-zinc-600 dark:bg-zinc-400',
    badge: 'border-zinc-500/40 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
    label: 'Reunião',
  },
  task_deadline: {
    icon: AlarmClock,
    chip: 'border-pink-500/40 bg-pink-500/10 text-pink-700 dark:text-pink-300',
    dot: 'bg-pink-600 dark:bg-pink-400',
    badge: 'border-pink-500/40 bg-pink-500/15 text-pink-700 dark:text-pink-300',
    label: 'Prazo',
  },
}

const KIND_ORDER: CalendarEventKind[] = ['session', 'hearing', 'committee_meeting', 'task_deadline']

/** Rótulos de status por tipo (hearing não tem mapa em contracts — mapa local de exibição). */
const KIND_STATUS_LABEL: Record<CalendarEventKind, Record<string, string>> = {
  session: SESSION_STATUS_LABEL,
  hearing: { scheduled: 'Agendada', open: 'Aberta', closed: 'Encerrada', canceled: 'Cancelada' },
  committee_meeting: COMMITTEE_MEETING_STATUS_LABEL,
  task_deadline: TASK_STATUS_LABEL,
}

const statusLabel = (e: CalendarEventView) => KIND_STATUS_LABEL[e.kind][e.status] ?? e.status

// ─── Datas: o servidor e o seed persistem o wall-clock institucional em UTC —
// exibir/grupar por dia em UTC preserva "19h" e o dia correto do evento.

const eventDayKey = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Chave do dia-calendário de uma Date local (célula da grade / hoje). */
const calendarDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const fmtEventTime = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const fmtEventDayTime = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const WEEKDAY_HEADERS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ─── Linha de evento (painel do dia + próximos eventos) ─────────────────────

function EventRow({ event, onGo }: { event: CalendarEventView; onGo: (m: string) => void }) {
  const meta = KIND_META[event.kind]
  const Icon = meta.icon
  return (
    <li className="rounded-lg border p-3 transition-colors hover:bg-accent/40">
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4', meta.badge)}>
          <Icon aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={event.title}>
            {event.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {fmtEventTime(event.date)} · {statusLabel(event)}
          </p>
          {event.meta && <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{event.meta}</p>}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={() => onGo(event.module ?? 'dashboard')}
        >
          Ir para…
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function AgendaModule() {
  const setModule = useApp((s) => s.setModule)
  const go = (m: string) => setModule(m as ModuleId)

  const today = useMemo(() => new Date(), [])
  const currentMonth = useMemo(() => startOfMonth(today), [today])

  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date())
  const [enabledKinds, setEnabledKinds] = useState<Record<CalendarEventKind, boolean>>({
    session: true,
    hearing: true,
    committee_meeting: true,
    task_deadline: true,
  })

  // Reset derivado no render (padrão React — sem setState em efeito): ao trocar
  // o mês navegado, o dia selecionado passa a ser hoje (se voltou ao mês
  // corrente) ou o dia 1 do novo mês.
  const [prevCursor, setPrevCursor] = useState(cursor)
  if (!isSameMonth(prevCursor, cursor)) {
    setPrevCursor(cursor)
    setSelectedDay(isSameMonth(cursor, today) ? today : cursor)
  }

  const year = cursor.getFullYear()
  const month = cursor.getMonth() + 1

  const calendarQuery = (y: number, m: number) =>
    apiFetch<CalendarResponse>(`/api/v1/calendar?year=${y}&month=${m}`)

  const monthQ = useQuery({ queryKey: ['calendar', year, month], queryFn: () => calendarQuery(year, month) })

  // Próximos eventos: mês corrente + mês seguinte (quando o 7º dia cai lá).
  const nextMonth = useMemo(() => addMonths(currentMonth, 1), [currentMonth])
  const currentQ = useQuery({
    queryKey: ['calendar', currentMonth.getFullYear(), currentMonth.getMonth() + 1],
    queryFn: () => calendarQuery(currentMonth.getFullYear(), currentMonth.getMonth() + 1),
  })
  const nextQ = useQuery({
    queryKey: ['calendar', nextMonth.getFullYear(), nextMonth.getMonth() + 1],
    queryFn: () => calendarQuery(nextMonth.getFullYear(), nextMonth.getMonth() + 1),
  })

  const events = monthQ.data?.events ?? []
  const counts = useMemo(() => {
    const c: Record<CalendarEventKind, number> = { session: 0, hearing: 0, committee_meeting: 0, task_deadline: 0 }
    for (const e of events) c[e.kind] += 1
    return c
  }, [events])

  const visible = useMemo(() => events.filter((e) => enabledKinds[e.kind]), [events, enabledKinds])

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEventView[]>()
    for (const e of visible) {
      const key = eventDayKey(e.date)
      const list = m.get(key)
      if (list) list.push(e)
      else m.set(key, [e])
    }
    for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date))
    return m
  }, [visible])

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
    return eachDayOfInterval({ start, end })
  }, [cursor])

  const dayEvents = byDay.get(calendarDayKey(selectedDay)) ?? []

  const upcoming = useMemo(() => {
    const horizon = addDays(today, 7)
    const all = [...(currentQ.data?.events ?? []), ...(nextQ.data?.events ?? [])]
    return all
      .filter((e) => {
        const d = new Date(e.date)
        return d >= startOfDay(today) && d <= horizon
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8)
  }, [currentQ.data, nextQ.data, today])

  const upcomingLoading = currentQ.isLoading || nextQ.isLoading
  const toggleKind = (k: CalendarEventKind) => setEnabledKinds((s) => ({ ...s, [k]: !s[k] }))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<CalendarDays />}
        title="Agenda Legislativa"
        description="Calendário unificado de sessões, audiências públicas, reuniões de comissão e prazos de tarefas — tudo o que acontece na Casa em um só lugar."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* ── Grade mensal ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}</CardTitle>
              <div className="flex items-center gap-1.5" role="navigation" aria-label="Navegação do calendário">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setCursor((m) => addMonths(m, -1))}
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setCursor(currentMonth)
                    setSelectedDay(today)
                  }}
                >
                  Hoje
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setCursor((m) => addMonths(m, 1))}
                  aria-label="Próximo mês"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <CardDescription>Filtre por tipo de evento (a contagem refere-se ao mês exibido).</CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              {KIND_ORDER.map((k) => {
                const meta = KIND_META[k]
                const Icon = meta.icon
                const on = enabledKinds[k]
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKind(k)}
                    aria-pressed={on}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      on ? meta.chip : 'border-border bg-muted/40 text-muted-foreground/60',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    <span>{CALENDAR_KIND_LABEL[k]}</span>
                    <span
                      className={cn(
                        'ml-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums',
                        on ? 'bg-background/70 text-foreground/80' : 'bg-muted text-muted-foreground/70'
                      )}
                    >
                      {counts[k]}
                    </span>
                  </button>
                )
              })}
            </div>
          </CardHeader>
          <CardContent>
            {monthQ.isLoading ? (
              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-none sm:h-24" />
                  ))}
                </div>
              </div>
            ) : monthQ.isError ? (
              <EmptyState
                icon={<RefreshCcw />}
                title="Não foi possível carregar a agenda"
                description={problemMessage(monthQ.error)}
                action={
                  <Button size="sm" variant="outline" onClick={() => void monthQ.refetch()}>
                    <RefreshCcw className="size-4" aria-hidden /> Tentar novamente
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                <div
                  className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border"
                  role="grid"
                  aria-label={`Calendário de ${format(cursor, 'MMMM yyyy', { locale: ptBR })}`}
                >
                  {WEEKDAY_HEADERS.map((w) => (
                    <div
                      key={w}
                      role="columnheader"
                      className="bg-muted/70 px-1 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                      aria-label={`Coluna ${w}`}
                    >
                      <span className="hidden sm:inline">{w}</span>
                      <span className="sm:hidden">{w.slice(0, 1)}</span>
                    </div>
                  ))}
                  {gridDays.map((day) => {
                    const inMonth = isSameMonth(day, cursor)
                    const isToday = isSameDay(day, today)
                    const selected = isSameDay(day, selectedDay)
                    const dayList = byDay.get(calendarDayKey(day)) ?? []
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        role="gridcell"
                        aria-selected={selected}
                        aria-label={`${format(day, "d 'de' MMMM", { locale: ptBR })}${dayList.length ? ` — ${dayList.length} evento(s)` : ''}`}
                        onClick={() => setSelectedDay(day)}
                        className={cn(
                          'min-h-20 min-w-0 bg-background p-1.5 text-left align-top transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:min-h-24',
                          !inMonth && 'bg-muted/30',
                          selected && 'outline-2 -outline-offset-2 outline-primary'
                        )}
                      >
                        <span
                          className={cn(
                            'inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                            isToday && 'bg-primary font-semibold text-primary-foreground',
                            !isToday && inMonth && 'text-foreground',
                            !inMonth && 'text-muted-foreground/50'
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                        <span className="mt-1 block space-y-1">
                          {dayList.slice(0, 3).map((e) => {
                            const meta = KIND_META[e.kind]
                            return (
                              <span
                                key={e.id}
                                className={cn(
                                  'flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight',
                                  meta.chip
                                )}
                                title={`${CALENDAR_KIND_LABEL[e.kind]} · ${e.title} · ${fmtEventTime(e.date)}`}
                              >
                                <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
                                <span className="min-w-0 truncate">{e.title}</span>
                              </span>
                            )
                          })}
                          {dayList.length > 3 && (
                            <span className="block px-1 text-[10px] font-medium text-muted-foreground">
                              +{dayList.length - 3} mais
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {events.length === 0 ? (
                  <EmptyState
                    icon={<Inbox />}
                    title="Nenhum evento neste mês"
                    description="Não há sessões, audiências, reuniões ou prazos agendados para o período."
                  />
                ) : visible.length === 0 ? (
                  <EmptyState
                    icon={<Inbox />}
                    title="Nenhum evento para os filtros selecionados"
                    description="Reative pelo menos um tipo de evento para visualizá-lo na grade."
                  />
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Painel do dia selecionado ───────────────────────────────── */}
        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle className="text-base">
              {format(selectedDay, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </CardTitle>
            <CardDescription>
              {isSameDay(selectedDay, today)
                ? 'Hoje'
                : isSameMonth(selectedDay, cursor)
                  ? 'Dia selecionado'
                  : 'Dia selecionado (outro mês)'}
              {dayEvents.length > 0 ? ` — ${dayEvents.length} evento(s)` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {monthQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-lg" />
                ))}
              </div>
            ) : monthQ.isError ? null : dayEvents.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Nenhum evento neste dia. Selecione um dia com marcadores na grade.
              </p>
            ) : (
              <ul className="max-h-[26rem] space-y-2 overflow-y-auto custom-scroll pr-0.5">
                {dayEvents.map((e) => (
                  <EventRow key={e.id} event={e} onGo={go} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Próximos eventos (7 dias) ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Próximos eventos</CardTitle>
          <CardDescription>
            Agenda dos próximos 7 dias a partir de hoje ({format(today, "d 'de' MMM", { locale: ptBR })}) — no máximo 8.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="Sem eventos nos próximos 7 dias"
              description="Nada agendado para esta semana. Novos prazos e eventos aparecem aqui automaticamente."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((e) => {
                const meta = KIND_META[e.kind]
                const Icon = meta.icon
                return (
                  <li key={e.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => go(e.module ?? 'dashboard')}
                      className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      title={`Ir para ${capitalize(e.module ?? '')}`}
                    >
                      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4', meta.badge)}>
                        <Icon aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
                          <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {meta.label}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                            {fmtEventDayTime(e.date)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-sm font-medium" title={e.title}>
                          {e.title}
                        </span>
                        {e.meta && <span className="block truncate text-xs text-muted-foreground">{e.meta}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
