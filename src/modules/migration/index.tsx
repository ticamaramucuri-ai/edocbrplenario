'use client'

/**
 * Fase 8 — Migração de Dados: wizard com os 8 estágios do pipeline auditável
 * (inspect → validate → plan → dry_run → import → reconcile → report → rollback),
 * execuções anteriores, homologação irreversível e rollback por run.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  DatabaseZap,
  FileSearch,
  History,
  Info,
  ListChecks,
  Play,
  RotateCcw,
  ShieldCheck,
  Sigma,
  Wand2,
  XCircle,
} from 'lucide-react'

import { migrationApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import { MIGRATION_SEVERITY_LABEL, MIGRATION_STAGES } from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const STAGE_ICONS: Record<string, React.ReactNode> = {
  inspect: <FileSearch className="size-4" />,
  validate: <ListChecks className="size-4" />,
  plan: <ClipboardCheck className="size-4" />,
  dry_run: <Wand2 className="size-4" />,
  import: <DatabaseZap className="size-4" />,
  reconcile: <Sigma className="size-4" />,
  report: <FileSearch className="size-4" />,
  rollback: <RotateCcw className="size-4" />,
}

function severityBadge(severity: string) {
  const map: Record<string, { className: string; icon: React.ReactNode }> = {
    info: { className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', icon: <Info className="size-3" /> },
    warn: { className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', icon: <AlertTriangle className="size-3" /> },
    error: { className: 'bg-red-500/15 text-red-700 dark:text-red-300', icon: <XCircle className="size-3" /> },
  }
  const cfg = map[severity] ?? map.info
  return (
    <Badge className={cfg.className}>
      {cfg.icon} {MIGRATION_SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  )
}

export default function MigrationModule() {
  const role = useApp((s) => s.actor?.role)
  const canManage = role === 'tenant_admin' || role === 'legislative_admin' || role === 'platform_owner'
  const queryClient = useQueryClient()
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [confirmHomologate, setConfirmHomologate] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)

  const runs = useQuery({ queryKey: ['migration-runs'], queryFn: migrationApi.listRuns, enabled: canManage })
  const activeRun = useQuery({
    queryKey: ['migration-run', activeRunId],
    queryFn: () => migrationApi.getRun(activeRunId!),
    enabled: !!activeRunId && canManage,
  })

  const invalidateRuns = () => {
    queryClient.invalidateQueries({ queryKey: ['migration-runs'] })
    if (activeRunId) queryClient.invalidateQueries({ queryKey: ['migration-run', activeRunId] })
  }

  const stageMutation = useMutation({
    mutationFn: ({ stage, runId }: { stage: string; runId?: string }) => migrationApi.runStage(stage, runId),
    onSuccess: (data) => {
      toast.success(`Estágio ${stageLabel(data.run.stage)} concluído`)
      setActiveRunId(data.run.id)
      invalidateRuns()
    },
  })

  const homologate = useMutation({
    mutationFn: (id: string) => migrationApi.homologate(id),
    onSuccess: () => {
      toast.success('Migração homologada', { description: 'Rollback definitivamente bloqueado — os dados importados são oficiais.' })
      setConfirmHomologate(false)
      invalidateRuns()
    },
  })

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Migração de Dados" description="Importador auditado do PainelDeskLegis 8.1 com pipeline completo." />
        <EmptyState
          icon={<Database className="size-8" />}
          title="Acesso restrito"
          description="A migração de dados exige o perfil Administrador da Câmara ou Administração Legislativa."
        />
      </div>
    )
  }

  const run = activeRun.data?.run
  const currentStageIndex = run ? MIGRATION_STAGES.findIndex((s) => s.id === run.stage) : -1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Migração de Dados"
        description="Importador auditado do PainelDeskLegis 8.1: pipeline com inspeção, validação, simulação, importação retomável, reconciliação, relatório e rollback."
      />

      {/* Wizard de estágios */}
      <section aria-label="Pipeline de migração" className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <h2 className="text-sm font-semibold">Pipeline desta execução</h2>
          {run && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{run.id.slice(0, 12)}…</span>
              {run.homologated && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="size-3" /> Homologada
                </Badge>
              )}
            </div>
          )}
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MIGRATION_STAGES.map((stage, i) => {
            const done = currentStageIndex >= i && !!run
            const isCurrent = run?.stage === stage.id
            const busy = stageMutation.isPending && stageMutation.variables?.stage === stage.id
            const disabled =
              stageMutation.isPending ||
              !canManage ||
              (run?.homologated ?? false) ||
              (stage.id !== 'inspect' && !activeRunId)
            return (
              <li key={stage.id}>
                <button
                  onClick={() => stageMutation.mutate({ stage: stage.id, runId: activeRunId ?? undefined })}
                  disabled={disabled}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
                    isCurrent && 'border-primary/60 bg-primary/5',
                    done && !isCurrent && 'border-emerald-500/40 bg-emerald-500/5',
                    !disabled && 'hover:border-primary/50 hover:bg-accent',
                    disabled && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      {STAGE_ICONS[stage.id]}
                      {i + 1}. {stage.label}
                    </span>
                    {done && <CheckCircle2 className="size-3.5 text-emerald-600" aria-label="Concluído" />}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">{stage.description}</span>
                  {busy && <span className="text-[11px] font-medium text-primary">Executando…</span>}
                </button>
              </li>
            )
          })}
        </ol>
        {!activeRunId && (
          <p className="pt-3 text-xs text-muted-foreground">
            Fonte legada sintética: <code className="rounded bg-muted px-1">upload/legacy/</code> (export PainelDeskLegis 8.1 — HSQLDB em CSV, dados fictícios 2021–2024 com órfãos e duplicidades propositais para exercitar a validação). Comece por <strong>Inspecionar</strong>.
          </p>
        )}
      </section>

      {/* Resultado da execução ativa */}
      {activeRunId && (
        <section aria-label="Resultado da execução" className="space-y-4">
          {activeRun.isLoading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : run ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estágio atual</p>
                    <p className="mt-1 text-lg font-bold">{stageLabel(run.stage)}</p>
                    <p className="text-xs text-muted-foreground">status: {run.status}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mapeamentos</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">{run.mappingCount}</p>
                    <p className="text-xs text-muted-foreground">IDs legados preservados</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Issues</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300">{run.issueCounts.info} info</Badge>
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">{run.issueCounts.warn} avisos</Badge>
                      <Badge className="bg-red-500/15 text-red-700 dark:text-red-300">{run.issueCounts.error} erros</Badge>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ações</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={run.homologated || !('report' in (run.stats ?? {})) || homologate.isPending}
                        onClick={() => setConfirmHomologate(true)}
                      >
                        <ShieldCheck /> Homologar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={run.homologated || run.mappingCount === 0 || stageMutation.isPending}
                        onClick={() => setConfirmRollback(true)}
                      >
                        <RotateCcw /> Rollback
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Stats por estágio */}
              {Object.entries(run.stats ?? {}).length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <h3 className="pb-2 text-sm font-semibold">Estatísticas por estágio</h3>
                    <div className="max-h-64 space-y-2 overflow-y-auto custom-scroll pr-1">
                      {Object.entries(run.stats as Record<string, unknown>).map(([stage, stat]) => (
                        <div key={stage} className="rounded-md border bg-muted/40 p-2.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{stageLabel(stage)}</p>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                            {JSON.stringify(stat, null, 1)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Issues */}
              {run.issues && run.issues.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <h3 className="pb-2 text-sm font-semibold">Divergências e avisos (nunca resolvidos silenciosamente)</h3>
                    <div className="max-h-96 overflow-y-auto custom-scroll pr-1">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card">
                          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 pr-2 font-medium">Severidade</th>
                            <th className="py-2 pr-2 font-medium">Referência</th>
                            <th className="py-2 font-medium">Mensagem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {run.issues.map((issue) => (
                            <tr key={issue.id} className="border-b last:border-0">
                              <td className="py-2 pr-2">{severityBadge(issue.severity)}</td>
                              <td className="py-2 pr-2 font-mono text-[11px] text-muted-foreground">{issue.sourceRef ?? '—'}</td>
                              <td className="py-2 text-xs">{issue.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </section>
      )}

      {/* Execuções anteriores */}
      <section aria-label="Execuções anteriores" className="rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <History className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Execuções</h2>
        </div>
        {runs.isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : runs.data && runs.data.runs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Iniciada em</th>
                  <th className="px-4 py-2.5 font-medium">Estágio</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Mapeamentos</th>
                  <th className="px-4 py-2.5 font-medium">Issues</th>
                  <th className="px-4 py-2.5 font-medium">Homologada</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {runs.data.runs.map((r) => (
                  <tr key={r.id} className={cn('border-b last:border-0 hover:bg-accent/40', activeRunId === r.id && 'bg-primary/5')}>
                    <td className="px-4 py-2.5 text-xs">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs font-medium">{stageLabel(r.stage)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={r.status === 'completed' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'} className="text-[11px]">
                        {r.status === 'completed' ? 'Concluída' : r.status === 'failed' ? 'Falhou' : 'Em execução'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{r.mappingCount}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <Badge variant="secondary" className="text-[10px]">{r.issueCounts.info}i</Badge>
                        <Badge variant="secondary" className="text-[10px]">{r.issueCounts.warn}a</Badge>
                        <Badge variant="secondary" className="text-[10px]">{r.issueCounts.error}e</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.homologated ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px]">
                          <ShieldCheck className="size-3" /> Sim
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Não</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Button variant="ghost" size="sm" onClick={() => setActiveRunId(r.id)}>
                        <Play className="size-3" /> Carregar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={<DatabaseZap className="size-7" />}
              title="Nenhuma execução ainda"
              description="Inicie o pipeline com o estágio Inspecionar — a fonte legada sintética já está em upload/legacy."
            />
          </div>
        )}
      </section>

      {/* Confirmações reforçadas */}
      <AlertDialog open={confirmHomologate} onOpenChange={setConfirmHomologate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Homologar a migração?</AlertDialogTitle>
            <AlertDialogDescription>
              A homologação é IRREVERSÍVEL: os dados importados tornam-se oficiais e o rollback desta
              execução fica definitivamente bloqueado. Confirme apenas após revisar o relatório e a
              reconciliação com a equipe da Câmara.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-700 hover:bg-emerald-800"
              onClick={() => activeRunId && homologate.mutate(activeRunId)}
            >
              <ShieldCheck /> Homologar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRollback} onOpenChange={setConfirmRollback}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Executar rollback?</AlertDialogTitle>
            <AlertDialogDescription>
              Serão removidos EXCLUSIVAMENTE os dados associados a esta execução (identificados pelos
              mapeamentos) — sessões, votações, votos, presenças, matérias, mandatos e parlamentares
              importados. A ação é auditada e não afeta dados homologados de outras execuções.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmRollback(false)
                stageMutation.mutate({ stage: 'rollback', runId: activeRunId ?? undefined })
              }}
            >
              <RotateCcw /> Remover dados desta execução
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function stageLabel(stage: string): string {
  return MIGRATION_STAGES.find((s) => s.id === stage)?.label ?? stage
}
