'use client'

/**
 * Legis SaaS — shell da aplicação (única rota visível).
 * SPA com troca de módulos no cliente, tema white-label, RBAC demo e tempo real.
 */

import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster, toast } from 'sonner'
import { RefreshCw, ShieldAlert, Landmark } from 'lucide-react'

import { useApp } from '@/lib/store'
import { api, ApiRequestError } from '@/lib/api-client'
import { useRealtime } from '@/hooks/use-realtime'
import { ROLE_LABEL } from '@/lib/contracts'
import type { ActorView, Role } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarDesktop, SidebarNav } from '@/components/app/sidebar'
import { Topbar } from '@/components/app/topbar'
import LoginForm, { type LoggedInActor } from '@/components/app/login-form'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// Módulos
import DashboardModule from '@/modules/dashboard'
import SessionsModule from '@/modules/sessions'
import PlenaryModule from '@/modules/plenary'
import DisplayModule from '@/modules/display'
import PwaModule from '@/modules/pwa'
import ParliamentariansModule from '@/modules/parliamentarians'
import MattersModule from '@/modules/matters'
import AuditModule from '@/modules/audit'
import ReportsModule from '@/modules/reports'
import PortalModule from '@/modules/portal'
import SettingsModule from '@/modules/settings'
import ConsoleModule from '@/modules/console'
import MigrationModule from '@/modules/migration'
import StructureModule from '@/modules/structure'
import WorkflowModule from '@/modules/workflow'
import WebhooksModule from '@/modules/webhooks'
import UsersModule from '@/modules/users'
import PublicationsModule from '@/modules/publications'
import AnalyticsModule from '@/modules/analytics'
import AgendaModule from '@/modules/agenda'
import TemplatesModule from '@/modules/templates'
import HelpModule from '@/modules/help'
import SupportModule from '@/modules/support'
import RoadmapModule from '@/modules/roadmap'
import IntegrationsModule from '@/modules/integrations'
import GrowthModule from '@/modules/growth'

function Boot({ children }: { children: React.ReactNode }) {
  const setBootstrap = useApp((s) => s.setBootstrap)
  const actorId = useApp((s) => s.actorId)
  const clearActor = useApp((s) => s.clearActor)

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api.bootstrap(),
    retry: 1,
  })

  useEffect(() => {
    if (data) setBootstrap(data)
  }, [data, setBootstrap])

  // actorId obsoleto (ex.: base re-semeada) → volta ao gate de entrada.
  // Correção E2E v0.13.0: NUNCA limpa enquanto o bootstrap está revalidando —
  // após um login real de outro tenant (ex.: Serra Azul) o dado ainda em cache
  // lista os atores do tenant default, e limpar aqui expulsaria o usuário que
  // acabou de autenticar (o gate reabria com a sessão ainda válida). A guarda
  // volta a rodar quando o dado novo chega: se o actorId realmente não existir
  // mais (re-seed), a limpeza acontece normalmente.
  useEffect(() => {
    if (data && actorId && !isFetching && !data.actors.find((a) => a.id === actorId)) {
      clearActor()
    }
  }, [data, actorId, clearActor, isFetching])

  // Erro global de API → toast (assinatura única)
  useEffect(() => {
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<ApiRequestError>).detail
      toast.error(detail?.problem?.title ?? 'Erro', {
        description: detail?.problem?.detail,
      })
    }
    window.addEventListener('legis:api-error', onError)
    return () => window.removeEventListener('legis:api-error', onError)
  }, [])

  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="text-lg font-semibold">Falha ao carregar o sistema</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Não foi possível obter os dados da plataforma (API <code>/api/v1/bootstrap</code>). Verifique o servidor e tente novamente.
        </p>
        <Button onClick={() => refetch()}>
          <RefreshCw /> Tentar novamente
        </Button>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-screen">
        <div className="flex items-center gap-3 border-b p-4">
          <Skeleton className="size-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-72" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  return <>{children}</>
}

function ActorGate({ children }: { children: React.ReactNode }) {
  const actor = useApp((s) => s.actor)
  const bootstrap = useApp((s) => s.bootstrap)
  const setActor = useApp((s) => s.setActor)
  const queryClient = useQueryClient()
  const open = !actor && !!bootstrap

  const handleLoggedIn = (a: LoggedInActor) => {
    const view: ActorView = {
      id: a.id,
      name: a.name,
      role: a.role as Role,
      jobTitle: a.jobTitle ?? null,
      parliamentarianId: a.parliamentarianId ?? null,
    }
    setActor(a.id, view)
    // Correção E2E v0.13.0 (F24): após o login real o bootstrap volta com o
    // tenant DA SESSÃO — white-label e banner de trial do tenant correto
    // (ex.: Serra Azul em trial) em vez do tenant default pré-login.
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    toast.success(`Bem-vindo(a), ${a.name}!`, {
      description: 'Autenticado com senha — sessão válida por 7 dias.',
    })
  }

  if (!open) return <>{children}</>

  return (
    <>
      {children}
      <Dialog open={open}>
        <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="size-5 text-primary" /> Bem-vindo(a) ao edocBR Plenário
            </DialogTitle>
            <DialogDescription>
              {bootstrap?.demoMode
                ? 'Entre com seu e-mail e senha ou escolha um perfil de demonstração.'
                : 'Entre com seu e-mail e senha para acessar o sistema.'}
            </DialogDescription>
          </DialogHeader>

          <LoginForm onLoggedIn={handleLoggedIn} />

          {bootstrap?.demoMode && <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              ou perfis de demonstração
            </span>
            <Separator className="flex-1" />
          </div>}

          {bootstrap?.demoMode && <ul className="max-h-72 space-y-1.5 overflow-y-auto custom-scroll pr-1">
            {(bootstrap?.actors ?? []).map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => {
                    setActor(a.id, a)
                    toast.success(`Perfil ativo: ${a.name}`, { description: ROLE_LABEL[a.role] })
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{a.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ROLE_LABEL[a.role]}{a.jobTitle ? ` · ${a.jobTitle}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ModuleRouter() {
  const activeModule = useApp((s) => s.activeModule)

  return useMemo(() => {
    switch (activeModule) {
      case 'dashboard':
        return <DashboardModule />
      case 'agenda':
        return <AgendaModule />
      case 'sessions':
        return <SessionsModule />
      case 'plenary':
        return <PlenaryModule />
      case 'display':
        return <DisplayModule />
      case 'pwa':
        return <PwaModule />
      case 'parliamentarians':
        return <ParliamentariansModule />
      case 'matters':
        return <MattersModule />
      case 'structure':
        return <StructureModule />
      case 'workflow':
        return <WorkflowModule />
      case 'audit':
        return <AuditModule />
      case 'reports':
        return <ReportsModule />
      case 'portal':
        return <PortalModule />
      case 'webhooks':
        return <WebhooksModule />
      case 'users':
        return <UsersModule />
      case 'templates':
        return <TemplatesModule />
      case 'help':
        return <HelpModule />
      case 'publications':
        return <PublicationsModule />
      case 'analytics':
        return <AnalyticsModule />
      case 'settings':
        return <SettingsModule />
      case 'console':
        return <ConsoleModule />
      case 'migration':
        return <MigrationModule />
      case 'support':
        return <SupportModule />
      case 'roadmap':
        return <RoadmapModule />
      case 'integrations':
        return <IntegrationsModule />
      case 'growth':
        return <GrowthModule />
      default:
        return <DashboardModule />
    }
  }, [activeModule])
}

function Shell() {
  const [mobileNav, setMobileNav] = useState(false)
  const activeModule = useApp((s) => s.activeModule)
  const setModule = useApp((s) => s.setModule)
  const tenant = useApp((s) => s.bootstrap?.tenant)
  const demoMode = useApp((s) => s.bootstrap?.demoMode ?? false)

  // Conexão de tempo real global (status na sidebar/topbar)
  useRealtime({})

  // Modo telão: chrome oculto, tela cheia
  if (activeModule === 'display') {
    return <DisplayModule />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar onOpenMobileNav={() => setMobileNav(true)} />
      <div className="flex flex-1">
        <SidebarDesktop />
        <main className="min-w-0 flex-1 lg:pl-60">
          <div className="mx-auto w-full max-w-7xl p-4 pb-12 sm:p-6">
            <ModuleRouter />
          </div>
        </main>
      </div>

      <footer className="mt-auto border-t bg-card/60 px-4 py-3 text-[11px] text-muted-foreground backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 pb-[env(safe-area-inset-bottom)] sm:flex-row">
          <p>
            <span className="font-semibold text-foreground">edocBR Plenário</span> ·
            {' '}Câmara: {tenant?.name ?? '—'}
          </p>
          <p>
            {demoMode ? 'Ambiente de demonstração · ' : ''}Fuso {tenant?.timezone ?? 'America/Bahia'} ·
            {' '}API <code className="rounded bg-muted px-1">/api/v1</code>
          </p>
        </div>
      </footer>

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu de módulos</SheetTitle>
          <SidebarNav onNavigate={() => setMobileNav(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default function Home() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
        },
      })
  )

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <Boot>
          <ActorGate>
            <Shell />
          </ActorGate>
        </Boot>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
