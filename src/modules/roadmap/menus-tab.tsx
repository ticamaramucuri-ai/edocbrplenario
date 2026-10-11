'use client'

/**
 * Aba "Menus e páginas (TO-BE v5)" do módulo Planejamento e Roadmap (Task 33-a).
 *
 * Mapa-alvo de 26 módulos do ROADMAP §12.0, agrupado por seção da sidebar.
 * Contadores no topo (novos / estendidos / existentes) e, por item, o estado
 * com badge (novo=default, estendido=secondary, existente=outline) e a nota
 * explicativa quando houver. Grid de 1 coluna no mobile, 2 a partir de sm.
 */
import { Compass } from 'lucide-react'

import type { RoadmapContent, RoadmapMenuItem } from '@/lib/contracts'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

function stateBadgeVariant(state: RoadmapMenuItem['state']) {
  if (state === 'novo') return 'default' as const
  if (state === 'estendido') return 'secondary' as const
  return 'outline' as const
}

const STATE_LABEL: Record<RoadmapMenuItem['state'], string> = {
  novo: 'Novo',
  estendido: 'Estendido',
  existente: 'Existente',
}

function CounterCard({
  state,
  count,
  description,
}: {
  state: RoadmapMenuItem['state']
  count: number
  description: string
}) {
  return (
    <Card className="min-w-0 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {STATE_LABEL[state]}
        </span>
        <Badge variant={stateBadgeVariant(state)}>{STATE_LABEL[state]}</Badge>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </Card>
  )
}

export function MenusTab({ data }: { data: RoadmapContent }) {
  const items = data.menuV5.flatMap((g) => g.items)
  const counts = { novo: 0, estendido: 0, existente: 0 }
  for (const item of items) counts[item.state] += 1

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Compass className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Mapa-alvo TO-BE v5 — {items.length} módulos distribuídos nas seções da
            navegação. Itens “estendidos” ganham funcionalidades específicas das Fases
            21–24; os “novos” entram no produto ao longo da Onda 5.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <CounterCard state="novo" count={counts.novo} description="módulos a criar" />
        <CounterCard
          state="estendido"
          count={counts.estendido}
          description="módulos a estender"
        />
        <CounterCard
          state="existente"
          count={counts.existente}
          description="módulos já entregues"
        />
      </div>

      <div className="max-h-[62vh] space-y-4 overflow-y-auto custom-scroll pr-1">
        {data.menuV5.map((g) => (
          <Card key={g.group}>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {g.group}
              </CardTitle>
              <CardDescription className="text-xs">
                {g.items.length} {g.items.length === 1 ? 'módulo' : 'módulos'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-2">
              {g.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-start justify-between gap-2.5 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{item.label}</p>
                    {item.note && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={stateBadgeVariant(item.state)}
                    className="shrink-0 capitalize"
                  >
                    {item.state}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
