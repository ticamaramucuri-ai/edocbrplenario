/**
 * Sidebar institucional — navegação por módulos.
 */
'use client'

import Link from 'next/link'
import {
  LayoutDashboard,
  CalendarClock,
  CalendarDays,
  Gavel,
  MonitorPlay,
  Smartphone,
  Users,
  FileText,
  ScrollText,
  Printer,
  Globe,
  Settings,
  Landmark,
  GitBranch,
  Webhook,
  Building2,
  Import,
  Newspaper,
  BarChart3,
  UserCog,
  FileStack,
  CircleHelp,
  Headset,
  Milestone,
  Plug,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp, type ModuleId } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ConnectionBadge } from '@/components/app/badges'
import { BrandLogo, TenantCrest } from '@/components/brand/brand-logo'

const MODULES: Array<{ id: ModuleId; label: string; icon: React.ReactNode; group: string; hint?: string }> = [
  { id: 'dashboard', label: 'Painel', icon: <LayoutDashboard />, group: 'Operação' },
  {
    id: 'agenda',
    label: 'Agenda Legislativa',
    icon: <CalendarDays />,
    group: 'Operação',
    hint: 'Calendário',
  },
  { id: 'sessions', label: 'Sessões', icon: <CalendarClock />, group: 'Operação' },
  { id: 'plenary', label: 'Mesa do Plenário', icon: <Gavel />, group: 'Operação', hint: 'Tempo real' },
  { id: 'display', label: 'Telão', icon: <MonitorPlay />, group: 'Operação', hint: 'Kiosk' },
  { id: 'pwa', label: 'App do Parlamentar', icon: <Smartphone />, group: 'Operação', hint: 'Mobile' },
  { id: 'workflow', label: 'Protocolo e Tramitação', icon: <GitBranch />, group: 'Processo Legislativo' },
  { id: 'parliamentarians', label: 'Parlamentares', icon: <Users />, group: 'Cadastros' },
  { id: 'matters', label: 'Matérias', icon: <FileText />, group: 'Cadastros' },
  { id: 'structure', label: 'Estrutura Institucional', icon: <Landmark />, group: 'Cadastros' },
  { id: 'audit', label: 'Auditoria', icon: <ScrollText />, group: 'Governança' },
  { id: 'reports', label: 'Relatórios', icon: <Printer />, group: 'Governança' },
  {
    id: 'publications',
    label: 'Publicações e Audiências',
    icon: <Newspaper />,
    group: 'Governança',
    hint: 'Diário',
  },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 />, group: 'Governança', hint: 'BI' },
  { id: 'portal', label: 'Portal Público', icon: <Globe />, group: 'Governança' },
  { id: 'webhooks', label: 'Webhooks', icon: <Webhook />, group: 'Governança', hint: 'Integração' },
  {
    id: 'integrations',
    label: 'Integrações & API',
    icon: <Plug />,
    group: 'Governança',
    hint: 'legk_',
  },
  { id: 'users', label: 'Usuários', icon: <UserCog />, group: 'Administração', hint: 'Acessos' },
  {
    id: 'templates',
    label: 'Modelos de Documento',
    icon: <FileStack />,
    group: 'Administração',
    hint: 'Modelos',
  },
  { id: 'settings', label: 'Configurações', icon: <Settings />, group: 'Administração' },
  { id: 'console', label: 'Console da Plataforma', icon: <Building2 />, group: 'Administração', hint: 'SaaS' },
  { id: 'migration', label: 'Migração de Dados', icon: <Import />, group: 'Administração' },
  {
    id: 'support',
    label: 'Suporte da Plataforma',
    icon: <Headset />,
    group: 'Administração',
    hint: 'Suporte',
  },
  {
    id: 'roadmap',
    label: 'Planejamento e Roadmap',
    icon: <Milestone />,
    group: 'Administração',
    hint: 'Onda 5',
  },
  {
    id: 'growth',
    label: 'Crescimento',
    icon: <TrendingUp />,
    group: 'Administração',
    hint: 'SaaS',
  },
  { id: 'help', label: 'Central de Ajuda', icon: <CircleHelp />, group: 'Ajuda', hint: '?' },
]

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const activeModule = useApp((s) => s.activeModule)
  const setModule = useApp((s) => s.setModule)
  const connection = useApp((s) => s.connection)
  const tenant = useApp((s) => s.bootstrap?.tenant ?? null)

  const groups = Array.from(new Set(MODULES.map((m) => m.group)))

  return (
    <nav aria-label="Módulos do sistema" className="flex h-full flex-col">
      <div className="border-b border-sidebar-border px-3 py-4">
        <BrandLogo inverse compact />
        {tenant && <div className="mt-3 flex items-center gap-2 border-t border-white/15 pt-3 text-[11px] text-sidebar-foreground/85">
          <TenantCrest logoUrl={tenant.logoUrl} name={tenant.name} className="size-8 rounded bg-white p-0.5" />
          <span className="line-clamp-2">{tenant.name}</span>
        </div>}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto custom-scroll px-2 pb-4">
        {groups.map((group) => (
          <div key={group}>
            <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">
              {group}
            </p>
            <ul className="space-y-0.5">
              {MODULES.filter((m) => m.group === group).map((m) => {
                const active = activeModule === m.id
                const Icon = m.icon
                return (
                  <li key={m.id}>
                    <Link
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        setModule(m.id)
                        onNavigate?.()
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                      )}
                    >
                      <span className="[&_svg]:size-4 [&_svg]:shrink-0">{Icon}</span>
                      <span className="flex-1 truncate">{m.label}</span>
                      {m.hint && (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                            m.hint === 'Tempo real'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-sidebar-primary/20 text-sidebar-foreground/80'
                          )}
                        >
                          {m.hint}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-sidebar-border px-4 py-3">
        <ConnectionBadge state={connection} className="text-sidebar-foreground/80" />
      </div>
    </nav>
  )
}

export function SidebarDesktop() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 bg-sidebar text-sidebar-foreground lg:block print:hidden">
      <SidebarNav />
    </aside>
  )
}

export function SidebarMobileTrigger({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export { Button }
