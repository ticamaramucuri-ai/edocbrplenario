'use client'

/**
 * Seletor de sessão da Mesa do Plenário — exibido quando não há sessão em foco.
 */

import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarDays, Gavel, MapPin, Users } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateShort, fmtTime } from '@/lib/format'
import { PageHeader } from '@/components/app/page-header'
import { SessionStatusBadge } from '@/components/app/badges'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LIVE_SESSION_STATUSES, sessionLabel, sortSessionsForPicker } from './helpers'

export function SessionPicker() {
  const setFocusSession = useApp((s) => s.setFocusSession)
  const { data, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.listSessions(),
  })

  const sessions = sortSessionsForPicker(data?.sessions ?? [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Gavel />}
        title="Mesa do Plenário"
        description="Escolha a sessão que você vai conduzir. A mesa concentra presença, pauta, votação, discursos e os comandos do telão."
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma sessão cadastrada. Crie uma sessão no módulo Sessões para conduzir a mesa.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((s) => {
            const live = LIVE_SESSION_STATUSES.includes(s.status)
            return (
              <Card
                key={s.id}
                className={
                  live
                    ? 'border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.15)] transition hover:border-emerald-500'
                    : 'transition hover:border-primary/40'
                }
              >
                <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">{sessionLabel(s)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Pauta com {s.agendaCount} {s.agendaCount === 1 ? 'item' : 'itens'}
                        {s.agendaPublished ? '' : ' · não publicada'}
                      </p>
                    </div>
                    <SessionStatusBadge status={s.status} />
                  </div>

                  <dl className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                      <span>
                        {fmtDateShort(s.scheduledAt)} · {fmtTime(s.scheduledAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="size-3.5 shrink-0" aria-hidden />
                      <span className="tabular-nums">
                        {s.presentCount} de {s.totalMembers} presentes
                      </span>
                    </div>
                    <div className="col-span-full flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{s.location}</span>
                    </div>
                  </dl>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="truncate text-xs text-muted-foreground">
                      Presidência: {s.presidentName ?? '—'}
                    </span>
                    <Button size="sm" onClick={() => setFocusSession(s.id)}>
                      Conduzir
                      <ArrowRight />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
