'use client'

/**
 * Módulo Estrutura Institucional — legislaturas, partidos/blocos, Mesa Diretora,
 * comissões e mandatos/afastamentos (Fase 5). Tabs shadcn/ui.
 */
import { Landmark } from 'lucide-react'

import { PageHeader } from '@/components/app/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import LegislaturesTab from './legislatures-tab'
import PartiesBlocsTab from './parties-blocs-tab'
import BoardTab from './board-tab'
import CommitteesTab from './committees-tab'
import MandatesLeavesTab from './mandates-leaves-tab'

export default function StructureModule() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Estrutura Institucional"
        description="Legislaturas, partidos e blocos, Mesa Diretora, comissões, mandatos e afastamentos. O histórico institucional é temporal e nunca é apagado."
        icon={<Landmark />}
      />

      <Tabs defaultValue="legislaturas" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="legislaturas">Legislaturas</TabsTrigger>
          <TabsTrigger value="partidos">Partidos e Blocos</TabsTrigger>
          <TabsTrigger value="mesa">Mesa Diretora</TabsTrigger>
          <TabsTrigger value="comissoes">Comissões</TabsTrigger>
          <TabsTrigger value="mandatos">Mandatos e Afastamentos</TabsTrigger>
        </TabsList>
        <TabsContent value="legislaturas" className="mt-2">
          <LegislaturesTab />
        </TabsContent>
        <TabsContent value="partidos" className="mt-2">
          <PartiesBlocsTab />
        </TabsContent>
        <TabsContent value="mesa" className="mt-2">
          <BoardTab />
        </TabsContent>
        <TabsContent value="comissoes" className="mt-2">
          <CommitteesTab />
        </TabsContent>
        <TabsContent value="mandatos" className="mt-2">
          <MandatesLeavesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
