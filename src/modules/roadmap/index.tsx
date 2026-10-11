'use client'

/**
 * v0.12.0 — Módulo "Planejamento e Roadmap" (24º módulo, menu Administração).
 *
 * UI completa (Task 33-a) sobre o contrato da Task 32:
 * GET /api/v1/roadmap (qualquer papel autenticado) + PATCH
 * /api/v1/roadmap/tasks/:id (somente platform_owner; demais recebem 403 e o
 * toast global dispara sem quebrar a UI — o valor do Select volta ao estado
 * persistido porque a query não é alterada localmente).
 *
 * Abas: Visão geral (estatísticas + progresso global + ondas entregues +
 * próximos passos) · Onda 5 — Fases (accordion F21–F24 com tasks rastreáveis
 * e edição de status) · Menus e páginas (mapa-alvo TO-BE v5) · Documentação
 * (pacote entregue + planejado) · Onda 6 (prévia de longo prazo).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BookOpen,
  Compass,
  LayoutDashboard,
  Milestone,
  RefreshCw,
  Telescope,
} from 'lucide-react'

import { useApp } from '@/lib/store'
import { ROADMAP_TASK_STATUS_LABEL, type RoadmapTaskStatus } from '@/lib/contracts'
import { roadmapApi } from '@/lib/api-client'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { OverviewTab } from './overview-tab'
import { PhasesTab } from './phases-tab'
import { MenusTab } from './menus-tab'
import { DocsTab } from './docs-tab'
import { Wave6Tab } from './wave6-tab'

function RoadmapSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="max-w-xl space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-9 w-full max-w-2xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl lg:col-span-2" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  )
}

export default function RoadmapModule() {
  const actor = useApp((s) => s.actor)
  const canManage = useApp((s) => s.can('platform.manage'))
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['roadmap'],
    queryFn: () => roadmapApi.content(),
    retry: 1,
  })

  const statusMutation = useMutation({
    mutationFn: (vars: { taskId: string; status: RoadmapTaskStatus }) =>
      roadmapApi.setTaskStatus(vars.taskId, vars.status),
    onSuccess: async (_result, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['roadmap'] })
      toast.success('Status da task atualizado', {
        description: `Novo status: ${ROADMAP_TASK_STATUS_LABEL[vars.status]}.`,
      })
    },
    onError: () => {
      // O toast de erro (403 RBAC, 422, rede…) já dispara pelo evento global
      // legis:api-error no api-client; a query permanece intacta e o controle
      // volta ao status persistido no banco.
    },
  })

  if (isError) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Planejamento e Roadmap"
          description="Não foi possível carregar o plano de continuidade do SaaS."
          icon={<Milestone />}
        />
        <EmptyState
          icon={<Milestone />}
          title="Falha ao carregar o roadmap"
          description="Verifique a conexão e tente novamente — o conteúdo é servido por GET /api/v1/roadmap para qualquer perfil autenticado."
          action={
            <Button onClick={() => refetch()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planejamento e Roadmap"
        description={
          data
            ? `Estado entregue (v${data.meta.currentVersion}, Ondas 1–5) e plano de continuidade: Onda 6 (Fases 25–28) rumo à v${data.meta.plannedVersion}, mapa-alvo de menus e pacote documental. Fonte: ${data.meta.source}.`
            : 'Carregando o plano de continuidade do SaaS…'
        }
        icon={<Milestone />}
        actions={
          data ? (
            <Badge variant="outline">
              {data.meta.modules} módulos · ~{data.meta.routeGroups} rotas
            </Badge>
          ) : undefined
        }
      />

      {isLoading ? (
        <RoadmapSkeleton />
      ) : data ? (
        <Tabs defaultValue="overview" className="gap-4">
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            <TabsTrigger value="overview">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              Visão geral
            </TabsTrigger>
            <TabsTrigger value="fases">
              <Milestone className="size-4" aria-hidden="true" />
              Onda 5 — Fases ✓
            </TabsTrigger>
            <TabsTrigger value="menus">
              <Compass className="size-4" aria-hidden="true" />
              Menus e páginas
            </TabsTrigger>
            <TabsTrigger value="docs">
              <BookOpen className="size-4" aria-hidden="true" />
              Documentação
            </TabsTrigger>
            <TabsTrigger value="onda6">
              <Telescope className="size-4" aria-hidden="true" />
              Onda 6 (prévia)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab data={data} />
          </TabsContent>

          <TabsContent value="fases">
            <PhasesTab
              phases={data.phases}
              canManage={canManage}
              actorName={actor?.name ?? null}
              pendingTaskId={
                statusMutation.isPending
                  ? (statusMutation.variables?.taskId ?? null)
                  : null
              }
              onSetStatus={(taskId, status) =>
                statusMutation.mutate({ taskId, status })
              }
            />
          </TabsContent>

          <TabsContent value="menus">
            <MenusTab data={data} />
          </TabsContent>

          <TabsContent value="docs">
            <DocsTab data={data} />
          </TabsContent>

          <TabsContent value="onda6">
            <Wave6Tab data={data} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}
