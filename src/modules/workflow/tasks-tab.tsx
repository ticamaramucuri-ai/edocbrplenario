'use client'

/**
 * Tab Prazos e Tarefas — cartões de contagem (pendentes, vencidas, concluídas),
 * tabela com vencidas destacadas (badge "Vencida" com texto), criar tarefa,
 * concluir/cancelar (justificativa).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  ListTodo,
  Plus,
  XCircle,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import { TASK_KIND_LABEL, TASK_STATUS_LABEL, type LegislativeTaskView } from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

export default function TasksTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('task.write')
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('todos')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [cancelling, setCancelling] = useState<LegislativeTaskView | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter, onlyOverdue],
    queryFn: () =>
      api.listTasks({
        status: statusFilter !== 'todos' ? statusFilter : undefined,
        overdue: onlyOverdue || undefined,
      }),
  })

  const tasks = data?.tasks ?? []
  const counts = data?.counts ?? {}

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] })

  const complete = useMutation({
    mutationFn: (id: string) => api.patchTask(id, { status: 'concluida' }),
    onSuccess: () => {
      toast.success('Tarefa concluída')
      invalidate()
    },
  })

  return (
    <div className="space-y-4">
      {/* Cartões de contagem */}
      <div className="grid grid-cols-3 gap-3">
        <Card className={counts.overdue > 0 ? 'border-rose-300 dark:border-rose-800' : undefined}>
          <CardContent className="flex items-center justify-between gap-2 p-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Vencidas</p>
              <p className="text-2xl font-bold tabular-nums">{counts.overdue ?? 0}</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <AlarmClock className="size-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-2 p-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pendentes</p>
              <p className="text-2xl font-bold tabular-nums">{counts.pendente ?? 0}</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ListTodo className="size-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-2 p-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Concluídas</p>
              <p className="text-2xl font-bold tabular-nums">{counts.concluida ?? 0}</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckSquare className="size-5" />
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Filtros + nova */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="task-status-filter" className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="task-status-filter" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {Object.entries(TASK_STATUS_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant={onlyOverdue ? 'default' : 'outline'}
          className={onlyOverdue ? 'bg-rose-600 hover:bg-rose-600' : undefined}
          onClick={() => setOnlyOverdue((v) => !v)}
        >
          <AlarmClock /> Só vencidas
        </Button>
        {canWrite && (
          <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus /> Nova tarefa
          </Button>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListTodo />}
          title="Nenhuma tarefa no filtro"
          description="Crie prazos, pareceres e distribuições para acompanhar o processo legislativo."
        />
      ) : (
        <div className="max-h-[26rem] overflow-y-auto custom-scroll rounded-lg border bg-card">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead scope="col">Tarefa</TableHead>
                <TableHead scope="col">Espécie</TableHead>
                <TableHead scope="col">Prazo</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Responsável</TableHead>
                {canWrite && <TableHead scope="col" className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id} className={t.overdue ? 'bg-rose-500/5' : undefined}>
                  <TableCell className="max-w-[18rem]">
                    <p className="truncate text-sm font-medium" title={t.title}>{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.matterLabel ? `Ref.: ${t.matterLabel}` : 'Sem matéria vinculada'}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {TASK_KIND_LABEL[t.kind] ?? t.kind}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {fmtDateTime(t.dueAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.overdue && (
                        <Badge className="gap-1 bg-rose-600 text-white hover:bg-rose-600">
                          <AlarmClock className="size-3" /> Vencida
                        </Badge>
                      )}
                      <TaskStatusBadge status={t.status} />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate text-sm text-muted-foreground">
                    {t.assigneeName ?? '—'}
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {t.status === 'pendente' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => complete.mutate(t.id)}
                              disabled={complete.isPending}
                            >
                              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Concluir
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                              onClick={() => setCancelling(t)}
                            >
                              <XCircle className="size-3.5" /> Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewTaskDialog open={createOpen} onOpenChange={setCreateOpen} onDone={invalidate} />
      <CancelTaskDialog task={cancelling} onOpenChange={(v) => !v && setCancelling(null)} onDone={invalidate} />
    </div>
  )
}

function TaskStatusBadge({ status }: { status: string }) {
  if (status === 'concluida')
    return (
      <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" /> {TASK_STATUS_LABEL.concluida}
      </Badge>
    )
  if (status === 'cancelada')
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <XCircle className="size-3" /> {TASK_STATUS_LABEL.cancelada}
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1">
      <CalendarClock className="size-3" /> {TASK_STATUS_LABEL.pendente}
    </Badge>
  )
}

function NewTaskDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('prazo')
  const [dueAt, setDueAt] = useState('')
  const [assigneeName, setAssigneeName] = useState('')
  const [matterId, setMatterId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mattersQ = useQuery({
    queryKey: ['matters', { tasks: 'active' }],
    queryFn: () => api.listMatters(),
  })
  const matters = (mattersQ.data?.matters ?? []).filter(
    (m) => m.status !== 'aprovado' && m.status !== 'rejeitado'
  )

  const mutation = useMutation({
    mutationFn: () =>
      api.createTask({
        title: title.trim(),
        kind,
        dueAt: new Date(dueAt).toISOString(),
        matterId: matterId || null,
        assigneeName: assigneeName.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Tarefa criada', { description: title.trim() })
      setTitle('')
      setKind('prazo')
      setDueAt('')
      setAssigneeName('')
      setMatterId('')
      setErrors({})
      onOpenChange(false)
      onDone()
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (title.trim().length < 3) errs.title = 'Informe o título da tarefa.'
    if (!dueAt) errs.dueAt = 'Informe o prazo.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>Prazos e pendências do processo legislativo, com destaque de vencidas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="task-title">Título *</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Elaborar parecer da CCJ" aria-invalid={!!errors.title} />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="task-kind">Espécie</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="task-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_KIND_LABEL).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-due">Prazo *</Label>
              <Input id="task-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-invalid={!!errors.dueAt} />
              {errors.dueAt && <p className="text-xs text-destructive">{errors.dueAt}</p>}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-matter">Matéria vinculada</Label>
            <Select value={matterId || 'nenhuma'} onValueChange={(v) => setMatterId(v === 'nenhuma' ? '' : v)}>
              <SelectTrigger id="task-matter" className="w-full">
                <SelectValue placeholder="Sem vínculo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">Sem vínculo</SelectItem>
                {matters.slice(0, 100).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.type.replace(/_/g, ' ').toUpperCase()} {m.number}/{m.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-assignee">Responsável</Label>
            <Input id="task-assignee" value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)} placeholder="Ex.: Diretoria Legislativa" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Criando…' : 'Criar tarefa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelTaskDialog({
  task,
  onOpenChange,
  onDone,
}: {
  task: LegislativeTaskView | null
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.patchTask(task!.id, { status: 'cancelada', justification: justification.trim() }),
    onSuccess: () => {
      toast.success('Tarefa cancelada', { description: 'Justificativa registrada na auditoria.' })
      setJustification('')
      setError(null)
      onOpenChange(false)
      onDone()
    },
  })

  const submit = () => {
    if (justification.trim().length < 5) {
      setError('A justificativa é obrigatória (mín. 5 caracteres).')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={!!task} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="size-5" /> Cancelar tarefa
          </DialogTitle>
          <DialogDescription>
            {task && (
              <>
                “{task.title}” será cancelada com justificativa auditada.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="task-cancel-reason">Justificativa *</Label>
          <Textarea
            id="task-cancel-reason"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            placeholder="Ex.: prazo substituído por nova distribuição regimental."
            aria-invalid={!!error}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Manter tarefa</Button>
          <Button variant="destructive" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Cancelando…' : 'Cancelar tarefa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
