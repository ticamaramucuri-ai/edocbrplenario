'use client'

/**
 * Aba "Documentação" do módulo Planejamento e Roadmap (Task 33-a).
 *
 * Pacote documental do sistema (ROADMAP §8): documentos entregues (com
 * caminho em mono) separados dos planejados na Onda 5 (ADR-022..025). Fecha
 * com a nota de documentação viva (Central de Ajuda + este módulo).
 */
import { Info } from 'lucide-react'

import type { RoadmapContent, RoadmapDocItem } from '@/lib/contracts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

function DocRow({ doc }: { doc: RoadmapDocItem }) {
  return (
    <li className="rounded-lg border p-3 sm:p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{doc.name}</p>
        <Badge variant={doc.status === 'entregue' ? 'default' : 'outline'}>
          {doc.status === 'entregue' ? 'Entregue' : 'Planejado'}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          {doc.phase}
        </Badge>
      </div>
      {doc.path && (
        <code className="mt-1.5 block break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {doc.path}
        </code>
      )}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{doc.content}</p>
    </li>
  )
}

export function DocsTab({ data }: { data: RoadmapContent }) {
  const entregues = data.docs.filter((d) => d.status === 'entregue')
  const planejados = data.docs.filter((d) => d.status === 'planejado')

  return (
    <div className="space-y-6">
      <section aria-labelledby="docs-entregues-heading" className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 id="docs-entregues-heading" className="text-sm font-semibold">
            Entregues
          </h3>
          <Badge variant="secondary">{entregues.length} documentos</Badge>
          <Separator className="flex-1" />
        </div>
        <ul className="max-h-[46vh] space-y-2.5 overflow-y-auto custom-scroll pr-1">
          {entregues.map((d) => (
            <DocRow key={d.name} doc={d} />
          ))}
        </ul>
      </section>

      {planejados.length > 0 ? (
        <section aria-labelledby="docs-planejados-heading" className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 id="docs-planejados-heading" className="text-sm font-semibold">
              Planejados — Onda 5
            </h3>
            <Badge variant="outline">{planejados.length} ADRs</Badge>
            <Separator className="flex-1" />
          </div>
          <ul className="space-y-2.5">
            {planejados.map((d) => (
              <DocRow key={d.name} doc={d} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nenhum documento planejado no momento — os ADRs da Onda 6 (Fases 25–28)
          serão registrados quando a onda for detalhada no ROADMAP §14.
        </p>
      )}

      <Card className="p-4">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Documentação viva: a Central de Ajuda e este módulo acompanham cada release
            do produto, enquanto o repositório (pasta docs/) permanece a fonte de verdade
            versionada junto com o código — ADRs registram as decisões, o contrato de API
            documenta as rotas e o ROADMAP mantém o plano de continuidade.
          </p>
        </div>
      </Card>
    </div>
  )
}
