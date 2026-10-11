'use client'

/**
 * Aba "Onda 5 — Fases" do módulo Planejamento e Roadmap (Task 33-a).
 *
 * Um Card expansível (Accordion) por fase F21–F24: código, nome, período e
 * progresso (done/total). Cada task exibe título, detalhe, badge de status
 * colorida e o registro "por {autor} em {dd/MM HH:mm}" quando existir.
 *
 * Edição: apenas platform_owner (can('platform.manage')) vê o Select de status
 * por task → PATCH /api/v1/roadmap/tasks/:id (RBAC server-side; demais papéis
 * recebem 403 e a UI permanece consistente com o dado persistido).
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ROADMAP_TASK_STATUS_LABEL,
  type RoadmapPhaseView,
  type RoadmapTaskStatus,
  type RoadmapTaskView,
} from '@/lib/contracts'
import { TASK_STATUSES, TaskStatusBadge, fmtTaskUpdate } from './shared'

function TaskRow({
  task,
  canManage,
  pending,
  onSetStatus,
}: {
  task: RoadmapTaskView
  canManage: boolean
  pending: boolean
  onSetStatus: (taskId: string, status: RoadmapTaskStatus) => void
}) {
  return (
    <li className="rounded-lg border p-3 sm:p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <p className="min-w-0 text-sm font-medium leading-snug">{task.title}</p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{task.detail}</p>
          {task.updatedByName && task.updatedAt && (
            <p className="text-xs text-muted-foreground">
              Atualizada por {task.updatedByName} em {fmtTaskUpdate(task.updatedAt)}
            </p>
          )}
        </div>
        {canManage && (
          <div className="shrink-0 sm:pt-0.5">
            <Select
              value={task.status}
              onValueChange={(v) => onSetStatus(task.id, v as RoadmapTaskStatus)}
              disabled={pending}
            >
              <SelectTrigger
                size="sm"
                className="w-full text-xs sm:w-44"
                aria-label={`Alterar status da task: ${task.title}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {ROADMAP_TASK_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </li>
  )
}

export function PhasesTab({
  phases,
  canManage,
  actorName,
  pendingTaskId,
  onSetStatus,
}: {
  phases: RoadmapPhaseView[]
  canManage: boolean
  actorName: string | null
  pendingTaskId: string | null
  onSetStatus: (taskId: string, status: RoadmapTaskStatus) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {canManage
          ? `Autenticado como ${actorName ?? 'dono da plataforma'} — selecione o novo status de cada task; a alteração é persistida (PATCH /api/v1/roadmap/tasks/:id) e registrada com autor e data/hora.`
          : 'Somente leitura — a atualização do progresso da Onda 5 é restrita ao dono da plataforma (platform_owner).'}
      </p>

      <div className="space-y-4">
        {phases.map((phase) => (
          <div
            key={phase.code}
            className="overflow-hidden rounded-xl border bg-card shadow-xs"
          >
            <Accordion type="single" collapsible>
              <AccordionItem value={phase.code}>
                <AccordionTrigger className="px-4 py-4 hover:no-underline sm:px-5">
                  <div className="flex flex-1 flex-col gap-2.5 pr-4 text-left sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <Badge
                        variant="secondary"
                        className="mt-0.5 shrink-0 font-mono text-xs"
                      >
                        {phase.code}
                      </Badge>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold leading-snug sm:text-base">
                          {phase.name}
                        </CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {phase.wave} · {phase.period}
                        </p>
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 items-center gap-3 sm:w-64">
                      <Progress
                        value={phase.progress.percent}
                        className="h-2 flex-1"
                        aria-label={`Progresso da fase ${phase.code}: ${phase.progress.percent} por cento`}
                      />
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {phase.progress.done}/{phase.progress.total} tasks
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 px-4 pb-5 sm:px-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {phase.objective}
                  </p>
                  {phase.tasks.length > 0 ? (
                    <ul className="space-y-2.5">
                      {phase.tasks.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          canManage={canManage}
                          pending={pendingTaskId === t.id}
                          onSetStatus={onSetStatus}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Fase sem tasks registradas.
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        ))}
      </div>
    </div>
  )
}
