/**
 * Command palette global (⌘K/Ctrl+K) — Fase 13, Task 22-a.
 *
 * Interface pública fixa (montada na topbar): <CommandPalette open onOpenChange />.
 * - Grupo(s) Navegação: os 22 módulos do sidebar (com grupos), sempre visíveis
 *   quando não há busca ativa.
 * - Grupo(s) Resultados: GET /api/v1/search (debounce 300ms, mínimo 2 caracteres)
 *   agrupados por seção, com skeletons durante o carregamento e estado vazio.
 * Enter navega (setModule); ESC fecha; 100% navegável por teclado.
 *
 * Nota de implementação: em vez do atalho `CommandDialog` (que não encaminha
 * `shouldFilter`/`value` para a raiz do cmdk), o diálogo é montado com os
 * mesmos componentes shadcn (Dialog + Command) replicando os estilos — o que
 * permite desligar o filtro client-side do cmdk (as seções vêm do servidor) e
 * controlar a seleção: sem isso, resultados assíncronos deixariam o Enter sem
 * destino (valor selecionado obsoleto no cmdk).
 */
'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleHelp,
  FileStack,
  FileText,
  GitBranch,
  Globe,
  Gavel,
  Import,
  Landmark,
  LayoutDashboard,
  MonitorPlay,
  Newspaper,
  Printer,
  ScrollText,
  Settings,
  Smartphone,
  UserCog,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Skeleton } from '@/components/ui/skeleton'
import { useApp, type ModuleId } from '@/lib/store'
import { useDebouncedValue } from '@/modules/_shared'
import {
  SEARCH_SECTION_LABEL,
  type SearchItemView,
  type SearchResponse,
  type SearchSectionId,
} from '@/lib/contracts'

// ─── Navegação — espelho dos MODULES do sidebar (22 módulos, 6 grupos) ──────

type NavEntry = { id: ModuleId; label: string; icon: LucideIcon; group: string }

const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Painel', icon: LayoutDashboard, group: 'Operação' },
  { id: 'agenda', label: 'Agenda Legislativa', icon: CalendarDays, group: 'Operação' },
  { id: 'sessions', label: 'Sessões', icon: CalendarClock, group: 'Operação' },
  { id: 'plenary', label: 'Mesa do Plenário', icon: Gavel, group: 'Operação' },
  { id: 'display', label: 'Telão', icon: MonitorPlay, group: 'Operação' },
  { id: 'pwa', label: 'App do Parlamentar', icon: Smartphone, group: 'Operação' },
  { id: 'workflow', label: 'Protocolo e Tramitação', icon: GitBranch, group: 'Processo Legislativo' },
  { id: 'parliamentarians', label: 'Parlamentares', icon: Users, group: 'Cadastros' },
  { id: 'matters', label: 'Matérias', icon: FileText, group: 'Cadastros' },
  { id: 'structure', label: 'Estrutura Institucional', icon: Landmark, group: 'Cadastros' },
  { id: 'audit', label: 'Auditoria', icon: ScrollText, group: 'Governança' },
  { id: 'reports', label: 'Relatórios', icon: Printer, group: 'Governança' },
  { id: 'publications', label: 'Publicações e Audiências', icon: Newspaper, group: 'Governança' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Governança' },
  { id: 'portal', label: 'Portal Público', icon: Globe, group: 'Governança' },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, group: 'Governança' },
  { id: 'users', label: 'Usuários', icon: UserCog, group: 'Administração' },
  { id: 'templates', label: 'Modelos de Documento', icon: FileStack, group: 'Administração' },
  { id: 'settings', label: 'Configurações', icon: Settings, group: 'Administração' },
  { id: 'console', label: 'Console da Plataforma', icon: Building2, group: 'Administração' },
  { id: 'migration', label: 'Migração de Dados', icon: Import, group: 'Administração' },
  { id: 'help', label: 'Central de Ajuda', icon: CircleHelp, group: 'Ajuda' },
]

const NAV_GROUPS = [
  'Operação',
  'Processo Legislativo',
  'Cadastros',
  'Governança',
  'Administração',
  'Ajuda',
]

const SECTION_ICON: Record<SearchSectionId, LucideIcon> = {
  matters: FileText,
  sessions: CalendarClock,
  parliamentarians: Users,
  publications: Newspaper,
}

/** Valor cmdk estável por item (highlight controlado depende disso). */
const navValue = (n: NavEntry) => `${n.label} · ${n.group}`
const resultValue = (item: SearchItemView, query: string) => `${item.title} ${item.hint ?? ''} ${query}`
const skeletonValue = (query: string, i: number) => `${query} carregando resultado ${i}`

// ─── Fetch local (api-client.ts intocável — mesmo padrão dos módulos) ───────

type Problem = { title?: string; detail?: string; status?: number; code?: string }

async function apiFetch<T>(path: string): Promise<T> {
  const headers = new Headers()
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const problem = (body ?? {}) as Problem
    throw new Error(problem.detail || problem.title || 'Erro na requisição.')
  }
  return body as T
}

// ─── Palette ────────────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const setModule = useApp((s) => s.setModule)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const debounced = useDebouncedValue(query, 300)
  const trimmed = debounced.trim()
  const searching = trimmed.length >= 2

  // Resets derivados no render (padrão React — sem setState em efeito):
  // 1) ao fechar a palette, a busca é limpa para a próxima abertura;
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open && query !== '') setQuery('')
  }
  // 2) ao trocar o termo (ou a fase nav↔resultados), a seleção volta ao topo.
  const [prevTerm, setPrevTerm] = useState(trimmed)
  if (trimmed !== prevTerm) {
    setPrevTerm(trimmed)
    setSelected(undefined)
  }

  // Atalho global ⌘K / Ctrl+K
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const searchQ = useQuery({
    queryKey: ['unified-search', trimmed],
    queryFn: () => apiFetch<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(trimmed)}`),
    enabled: open && searching,
    staleTime: 30_000,
    retry: false,
  })

  const go = (id: string) => {
    setModule(id as ModuleId)
    onOpenChange(false)
  }

  const sections = (searchQ.data?.sections ?? []).filter((s) => s.items.length > 0)

  // Seleção controlada: undefined = "primeiro item visível" (nav, skeleton ou
  // resultado) — garante Enter sempre acionar o item do topo, inclusive com
  // resposta em cache (sem fase de skeleton).
  const fallbackValue = !searching
    ? navValue(NAV[0])
    : searchQ.isLoading
      ? skeletonValue(trimmed, 0)
      : sections.length > 0 && sections[0].items.length > 0
        ? resultValue(sections[0].items[0], trimmed)
        : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Pesquisa unificada</DialogTitle>
          <DialogDescription>
            Busque matérias, sessões, parlamentares e publicações, ou navegue entre os módulos do
            sistema.
          </DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          value={selected ?? fallbackValue}
          onValueChange={(v) => setSelected(v || undefined)}
          className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Pesquisar matérias, sessões, parlamentares, publicações… (mín. 2 caracteres)"
          />
          <CommandList>
            <CommandEmpty>
              {searching ? `Nenhum resultado para “${trimmed}”.` : 'Nenhum comando encontrado.'}
            </CommandEmpty>

            {/* Resultados — carregando (3 skeletons) */}
            {searching && searchQ.isLoading ? (
              <CommandGroup heading="Resultados">
                {[0, 1, 2].map((i) => (
                  <CommandItem key={i} value={skeletonValue(trimmed, i)} onSelect={() => {}}>
                    <Skeleton className="size-4 rounded" aria-hidden />
                    <span className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {/* Resultados — erro */}
            {searching && searchQ.isError ? (
              <CommandGroup heading="Resultados">
                <CommandItem value={`${trimmed} erro pesquisa`} onSelect={() => {}}>
                  <AlertTriangle className="text-destructive" aria-hidden />
                  <span className="text-sm text-destructive">
                    Falha na pesquisa —{' '}
                    {searchQ.error instanceof Error ? searchQ.error.message : 'tente novamente.'}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}

            {/* Resultados — grupos por seção */}
            {searching && searchQ.isSuccess
              ? sections.map((section, si) => {
                  const SectionIcon = SECTION_ICON[section.id]
                  return (
                    <CommandGroup
                      key={section.id}
                      heading={`${SEARCH_SECTION_LABEL[section.id]} · ${section.items.length}`}
                    >
                      {section.items.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={resultValue(item, trimmed)}
                          onSelect={() => go(item.module)}
                        >
                          <SectionIcon aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{item.title}</span>
                            {item.hint && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.hint}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      ))}
                      {si === sections.length - 1 && <CommandSeparator />}
                    </CommandGroup>
                  )
                })
              : null}

            {/* Navegação — os 22 módulos; sempre visível quando não há busca ativa */}
            {!searching &&
              NAV_GROUPS.map((group) => (
                <CommandGroup key={group} heading={group}>
                  {NAV.filter((n) => n.group === group).map((n) => {
                    const Icon = n.icon
                    return (
                      <CommandItem key={n.id} value={navValue(n)} onSelect={() => go(n.id)}>
                        <Icon aria-hidden />
                        <span className="flex-1">{n.label}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
