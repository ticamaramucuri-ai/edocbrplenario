'use client'

/**
 * Tab Em Tramitação — matérias em situações não-terminais com último andamento;
 * linha clicável abre o drawer lateral com timeline, registro de andamento,
 * versões e anexos.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'

import { api } from '@/lib/api-client'
import { matterLabel } from '@/lib/format'
import {
  MATTER_STATUS_LABEL,
  MATTER_TYPE_LABEL,
  PROCEEDING_ACTION_LABEL,
  type MatterView,
  type ProceedingView,
} from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtDateTime } from '@/lib/format'
import MatterDrawer, { MatterStatusBadge } from './matter-drawer'

const NON_TERMINAL = ['em_tramitacao', 'incluida_pauta', 'arquivado']

type TramitacaoData = {
  matters: MatterView[]
  lastMap: Record<string, ProceedingView | null>
}

export default function ProceedingsTab() {
  const [selected, setSelected] = useState<MatterView | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['workflow', 'tramitacao'],
    queryFn: async (): Promise<TramitacaoData> => {
      const res = await api.listMatters()
      const active = res.matters
        .filter((m) => NON_TERMINAL.includes(m.status))
        .sort((a, b) => a.number - b.number)
        .slice(0, 30)
      const lastMap: Record<string, ProceedingView | null> = {}
      await Promise.all(
        active.map(async (m) => {
          const p = await api.listProceedings(m.id)
          lastMap[m.id] = p.proceedings[p.proceedings.length - 1] ?? null
        })
      )
      return { matters: active, lastMap }
    },
  })

  const matters = data?.matters ?? []
  const lastMap = data?.lastMap ?? {}

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Matérias em situações não-terminais (em tramitação, incluídas em pauta ou arquivadas). Clique na linha para
        abrir a tramitação completa.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : matters.length === 0 ? (
        <EmptyState
          icon={<GitBranch />}
          title="Nenhuma matéria em tramitação"
          description="Cadastre matérias no módulo Matérias — a tramitação aparece aqui automaticamente."
        />
      ) : (
        <div className="max-h-[32rem] overflow-y-auto custom-scroll rounded-lg border bg-card">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead scope="col">Matéria</TableHead>
                <TableHead scope="col">Tipo</TableHead>
                <TableHead scope="col">Ementa</TableHead>
                <TableHead scope="col">Situação</TableHead>
                <TableHead scope="col">Último andamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matters.map((m) => {
                const last = lastMap[m.id]
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(m)}
                    aria-label={`Abrir tramitação de ${matterLabel(m.type, m.number, m.year)}`}
                  >
                    <TableCell className="whitespace-nowrap font-mono text-sm font-bold">
                      {matterLabel(m.type, m.number, m.year)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {MATTER_TYPE_LABEL[m.type] ?? m.type}
                    </TableCell>
                    <TableCell className="max-w-[18rem]">
                      <span className="line-clamp-1 text-sm text-muted-foreground">{m.ementa}</span>
                    </TableCell>
                    <TableCell>
                      <MatterStatusBadge status={m.status} />
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      {last ? (
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {PROCEEDING_ACTION_LABEL[last.action] ?? last.action}
                            <span className="ml-1 font-mono text-[11px] text-muted-foreground">seq {last.seq}</span>
                          </p>
                          <p className="text-[11px] text-muted-foreground">{fmtDateTime(last.createdAt)}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem andamentos</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <MatterDrawer matter={selected} onOpenChange={() => setSelected(null)} />
    </div>
  )
}
