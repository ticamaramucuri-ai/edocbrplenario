'use client'

/**
 * Aba "Visão geral" do módulo Planejamento e Roadmap (Task 33-a).
 *
 * Estatísticas do estado entregue (versão, módulos, rotas, ADRs), progresso
 * global da Onda 5 (média ponderada: tasks concluídas / total de tasks),
 * infraestrutura de serviços, timeline das ondas entregues (Fases 0–20),
 * próximas tasks pendentes e próximos marcos da ordem de execução (§12.5).
 */
import {
  CheckCircle2,
  GitBranch,
  History,
  LayoutGrid,
  ListTodo,
  Milestone,
  Route,
  ScrollText,
  ServerCog,
} from 'lucide-react'

import type { RoadmapContent, RoadmapTaskView } from '@/lib/contracts'
import {
  Badge,
} from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { StatCard, TaskStatusBadge } from './shared'

export function OverviewTab({ data }: { data: RoadmapContent }) {
  const phases = data.phases
  const totalTasks = phases.reduce((acc, p) => acc + p.progress.total, 0)
  const doneTasks = phases.reduce((acc, p) => acc + p.progress.done, 0)
  const globalPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  // 5 primeiras tasks não concluídas — fases e tasks já vêm ordenadas por ordem.
  const nextTasks: RoadmapTaskView[] = phases
    .flatMap((p) => p.tasks.filter((t) => t.status !== 'concluido'))
    .slice(0, 5)

  const upcoming = data.execution.filter((e) => e.status === 'planejada')

  return (
    <div className="space-y-6">
      {/* Estatísticas do estado entregue */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Versão atual"
          value={`v${data.meta.currentVersion}`}
          hint={`Planejada: v${data.meta.plannedVersion} (Onda 6 — Fases 25–28)`}
          icon={<GitBranch />}
        />
        <StatCard
          title="Módulos"
          value={data.meta.modules}
          hint="incluindo este Planejamento e Roadmap"
          icon={<LayoutGrid />}
        />
        <StatCard
          title="Grupos de rotas"
          value={`~${data.meta.routeGroups}`}
          hint="API REST versionada em /api/v1"
          icon={<Route />}
        />
        <StatCard
          title="ADRs"
          value={data.meta.adrs}
          hint="decisões de arquitetura registradas"
          icon={<ScrollText />}
        />
      </div>

      {/* Progresso global da Onda 5 + serviços */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">
                Onda 5 — Fases 21–24 · progresso global
              </CardTitle>
              <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3" aria-hidden /> entregue na v{data.meta.currentVersion}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Percentual ponderado: tasks concluídas em relação ao total da onda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Progress
                value={globalPercent}
                className="h-2.5 flex-1"
                aria-label={`Progresso global da Onda 5: ${globalPercent} por cento`}
              />
              <span className="text-sm font-semibold tabular-nums">{globalPercent}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {doneTasks} de {totalTasks} tasks concluídas — Onda 5 fechada na
              v{data.meta.currentVersion}; o histórico por fase fica na aba “Onda 5 — Fases”.
            </p>
            <Separator />
            <ul className="space-y-2.5">
              {phases.map((p) => (
                <li key={p.code} className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className="w-11 justify-center font-mono text-[11px]"
                  >
                    {p.code}
                  </Badge>
                  <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
                    {p.name}
                  </span>
                  <Progress
                    value={p.progress.percent}
                    className="h-1.5 w-24 shrink-0 sm:w-32"
                    aria-label={`Progresso da fase ${p.code}: ${p.progress.percent} por cento`}
                  />
                  <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {p.progress.done}/{p.progress.total}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Serviços do sistema</CardTitle>
            <CardDescription className="text-xs">
              Mini-serviços independentes atrás do gateway.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {data.meta.miniServices.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <ServerCog className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {s}
                  </code>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              O tempo real (outbox) e os webhooks rodam como processos próprios; o gateway
              Caddy expõe uma única porta para o navegador.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Ondas entregues + próximos passos (min-w-0 evita blowout do grid
          com palavras longas unidas por barra nas sinopses) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-primary" aria-hidden="true" />
              Ondas entregues
            </CardTitle>
            <CardDescription className="text-xs">
              Fases 0–20 — da fundação multi-tenant à operação e suporte.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-6 border-l pl-6">
              {data.delivered.map((w) => (
                <li key={w.wave} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 -left-[27px] size-2.5 rounded-full border-2 border-background bg-primary"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{w.wave}</span>
                    <Badge variant="secondary">{w.version}</Badge>
                    <span className="text-xs text-muted-foreground">{w.phases}</span>
                  </div>
                  <p className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
                    {w.summary}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ListTodo className="size-4 text-primary" aria-hidden="true" />
                Próximas tasks
              </CardTitle>
              <CardDescription className="text-xs">
                Primeiras 5 pendências da Onda 5, por fase e ordem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {nextTasks.length > 0 ? (
                <ul className="space-y-2.5">
                  {nextTasks.map((t) => (
                    <li key={t.id} className="space-y-1.5 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {t.phaseCode}
                        </Badge>
                        <TaskStatusBadge status={t.status} />
                      </div>
                      <p className="text-sm leading-snug">{t.title}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma pendência — todas as tasks da Onda 5 estão concluídas.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Milestone className="size-4 text-primary" aria-hidden="true" />
                Próximos marcos
              </CardTitle>
              <CardDescription className="text-xs">
                Ordem de execução planejada (ROADMAP §12.5).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {upcoming.length > 0 ? (
                <ul className="max-h-72 space-y-2.5 overflow-y-auto custom-scroll pr-1">
                  {upcoming.map((e) => (
                    <li key={e.task} className="flex items-start gap-2.5">
                      <Badge
                        variant="secondary"
                        className="mt-0.5 shrink-0 font-mono text-[11px]"
                      >
                        Task {e.task}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm leading-snug">{e.phase}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Executor: {e.executor}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ordem de execução da Onda 5 concluída (10/10 tasks) — a próxima onda
                  (Onda 6 — Fases 25–28) será detalhada no ROADMAP §14 e aparecerá aqui
                  quando planejada.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
