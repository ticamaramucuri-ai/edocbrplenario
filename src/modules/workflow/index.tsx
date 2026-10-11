'use client'

/**
 * Módulo Protocolo e Tramitação — livro de protocolo, matérias em tramitação
 * (timeline lateral) e prazos/tarefas (Fase 5).
 */
import { GitBranch } from 'lucide-react'

import { PageHeader } from '@/components/app/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ProtocolTab from './protocol-tab'
import ProceedingsTab from './proceedings-tab'
import TasksTab from './tasks-tab'

export default function WorkflowModule() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Protocolo e Tramitação"
        description="Livro de protocolo com numeração automática, tramitação append-only das matérias e controle de prazos e tarefas."
        icon={<GitBranch />}
      />

      <Tabs defaultValue="protocolo" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="protocolo">Protocolo</TabsTrigger>
          <TabsTrigger value="tramitacao">Em Tramitação</TabsTrigger>
          <TabsTrigger value="tarefas">Prazos e Tarefas</TabsTrigger>
        </TabsList>
        <TabsContent value="protocolo" className="mt-2">
          <ProtocolTab />
        </TabsContent>
        <TabsContent value="tramitacao" className="mt-2">
          <ProceedingsTab />
        </TabsContent>
        <TabsContent value="tarefas" className="mt-2">
          <TasksTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
