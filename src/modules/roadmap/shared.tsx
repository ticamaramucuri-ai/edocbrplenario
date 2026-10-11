'use client'

/**
 * Peças compartilhadas do módulo "Planejamento e Roadmap" (Task 33-a).
 *
 * Badge de status de task com cor institucional (pendente=zinc/outline,
 * em andamento=âmbar, concluído=verde, bloqueado=vermelho), cartão de
 * estatística (padrão do Analytics) e formatador de data/hora (date-fns,
 * locale pt-BR — mesmo padrão de Templates/Publicações).
 */
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import { ROADMAP_TASK_STATUS_LABEL, type RoadmapTaskStatus } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Os 4 status aceitos pelo PATCH /api/v1/roadmap/tasks/:id. */
export const TASK_STATUSES: RoadmapTaskStatus[] = [
  'pendente',
  'em_andamento',
  'concluido',
  'bloqueado',
]

/** Cor do badge por status (tema global — funciona em claro e escuro). */
const STATUS_CLASS: Record<RoadmapTaskStatus, string> = {
  pendente: 'text-zinc-600 dark:text-zinc-400',
  em_andamento: 'border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  concluido:
    'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  bloqueado: 'border-destructive/40 bg-destructive/10 text-destructive',
}

/** Cor do marcador circular ao lado do rótulo. */
const STATUS_DOT: Record<RoadmapTaskStatus, string> = {
  pendente: 'bg-zinc-400 dark:bg-zinc-500',
  em_andamento: 'bg-amber-500',
  concluido: 'bg-emerald-500',
  bloqueado: 'bg-red-500',
}

export function TaskStatusBadge({
  status,
  className,
}: {
  status: RoadmapTaskStatus
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn('gap-1.5', STATUS_CLASS[status], className)}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {ROADMAP_TASK_STATUS_LABEL[status]}
    </Badge>
  )
}

/** Cartão de estatística — mesmo padrão do módulo Analytics. */
export function StatCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string
  value: React.ReactNode
  hint?: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4"
        >
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** "dd/MM HH:mm" para o registro "por {autor} em {data}" das tasks. */
export function fmtTaskUpdate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return format(d, 'dd/MM HH:mm', { locale: ptBR })
}
