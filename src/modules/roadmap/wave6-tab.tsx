'use client'

/**
 * Aba "Onda 6 (prévia)" do módulo Planejamento e Roadmap (Task 33-a).
 *
 * Prévia de longo prazo das Fases 25–28 (ROADMAP §13/§14): alinhamento de
 * direção — com a Onda 5 CONCLUÍDA (v0.13.0), a especificação detalhada
 * (§14 do ROADMAP) é o próximo passo de planejamento.
 */
import { Telescope } from 'lucide-react'

import type { RoadmapContent } from '@/lib/contracts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function Wave6Tab({ data }: { data: RoadmapContent }) {
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex gap-3">
          <Telescope className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Prévia de longo prazo — Fases 25–28</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Alinhamento de direção com a Onda 5 concluída (v{data.meta.currentVersion}):
              a Onda 6 será especificada em detalhe no ROADMAP (§14), seguindo o mesmo
              padrão de planejamento deste documento. Origem: {data.meta.source}.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {data.wave6.map((p) => (
          <Card key={p.code}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2.5">
                <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                  {p.code}
                </Badge>
                <CardTitle className="text-sm font-semibold leading-snug">
                  {p.name}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
