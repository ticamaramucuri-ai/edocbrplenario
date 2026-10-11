/**
 * Topbar — marca white-label do tenant, sessão ao vivo, sino de notificações
 * (Fase 6: polling 30s + refresh por evento realtime notification.new),
 * ator (RBAC) e tema.
 *
 * Fase 20 (impersonação auditada): banner âmbar permanente ACIMA do header
 * enquanto o ator da sessão é um alvo de suporte (ator.impersonation da store,
 * sincronizado com /auth/me a cada 60s — expiração LAZY do servidor reflete no
 * banner sem recarregar a página). O banner é visível em TODOS os módulos e
 * nunca pode ser dispensado; o botão “Encerrar agora” chama
 * /platform/impersonations/:id/end e devolve o ator ao suporte.
 *
 * Onda 5 / Fase 24 — banner de TRIAL: faixa fina abaixo do header para atores
 * com tenant em trial (dias restantes) ou vencido (leitura liberada / gravação
 * bloqueada). Some para papéis platform_* e para tenants sem trial.
 */
'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Menu, Moon, Sun, Landmark, ChevronDown, Radio, Bell, CheckCheck, BellRing, LogOut, Search, ShieldAlert, Timer, Hourglass } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'

import { useApp, type ModuleId } from '@/lib/store'
import { api } from '@/lib/api-client'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ROLE_LABEL, SESSION_STATUS_LABEL } from '@/lib/contracts'
import { ConnectionBadge } from '@/components/app/badges'
import { CommandPalette } from '@/components/app/command-palette'
import { TenantCrest } from '@/components/brand/brand-logo'
import { useMe, type MeView } from '@/hooks/use-auth-me'
import { cn } from '@/lib/utils'
import { MODULE_IDS, NOTIFICATION_KIND_LABEL } from '@/lib/contracts'

const KIND_ICON_COLOR: Record<string, string> = {
  session: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  voting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  task: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  webhook: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  system: 'bg-primary/15 text-primary',
}

// ─── Banner de impersonação de suporte (Fase 20 / ADR-021) ──────────────────

/** ActorView a partir do ator devolvido por /auth/me (banner incluso). */
function actorFromMe(meActor: MeView['actor']) {
  return {
    id: meActor.id,
    name: meActor.name,
    role: meActor.role,
    jobTitle: meActor.jobTitle ?? null,
    parliamentarianId: meActor.parliamentarianId ?? null,
    impersonation: meActor.impersonation ?? null,
  }
}

/** Chip "termina em X min" — contagem a partir do expiresAt (remonta a cada
 * impersonação: o valor inicial é capturado no mount e o ticker de 30s o mantém
 * justo; sem setState síncrono dentro de efeito). */
function CountdownChip({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const minutesLeft = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000))
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-600/60 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold tabular-nums dark:border-amber-400/50 dark:bg-amber-500/15"
      aria-label={`A impersonação termina em ${minutesLeft} minutos`}
    >
      <Timer className="size-3" aria-hidden />
      termina em {minutesLeft} min
    </span>
  )
}

function ImpersonationBanner() {
  const actor = useApp((s) => s.actor)
  const setActor = useApp((s) => s.setActor)
  const queryClient = useQueryClient()
  const me = useMe()
  const impersonation = actor?.impersonation ?? null

  // Sincronização com o servidor (polling de 60s do useMe): expiração LAZY e
  // encerramento por outra via refletem no banner sem recarregar a página.
  useEffect(() => {
    const meActor = me.data?.actor
    if (!meActor) return // modo demo (sem sessão) — nada a sincronizar
    if (meActor.impersonation) {
      const sameActor =
        actor?.id === meActor.id &&
        actor?.impersonation?.impersonationId === meActor.impersonation.impersonationId
      if (!sameActor) setActor(meActor.id, actorFromMe(meActor))
    } else if (actor?.impersonation) {
      // A impersonação acabou no servidor (prazo vencido ou encerrada em outra
      // aba): o ator volta a ser o usuário real da sessão.
      setActor(meActor.id, actorFromMe(meActor))
      void queryClient.invalidateQueries()
      toast.info('Impersonação encerrada', {
        description: 'O prazo da operação como outro usuário expirou — você voltou ao seu usuário.',
      })
    }
  }, [me.data, actor, setActor, queryClient])

  const endImpersonation = useMutation({
    mutationFn: async (impersonationId: string) => {
      const res = await fetch(`/api/v1/platform/impersonations/${impersonationId}/end`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(problem?.detail ?? 'Falha ao encerrar a impersonação.')
      }
      const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' })
      if (!meRes.ok) throw new Error('Sessão não encontrada após encerrar — entre novamente.')
      return (await meRes.json()) as MeView
    },
    onSuccess: (meBody) => {
      setActor(meBody.actor.id, actorFromMe(meBody.actor))
      void queryClient.invalidateQueries()
      void me.refetch()
      toast.success('Impersonação encerrada', {
        description: 'Você voltou a operar com o seu próprio usuário.',
      })
    },
    onError: (err) => {
      toast.error('Falha ao encerrar a impersonação', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      })
    },
  })

  if (!impersonation) return null

  return (
    <div
      role="alert"
      aria-label="Banner de impersonação de suporte"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-600/70 bg-amber-400/25 px-3 py-2 text-amber-950 backdrop-blur dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-100 sm:px-4"
    >
      <ShieldAlert className="size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1 text-xs font-semibold leading-snug sm:text-sm">
        Suporte da Plataforma ({impersonation.supportName}) operando como {impersonation.targetName}
        <span className="block truncate font-normal sm:ml-2 sm:inline">
          {impersonation.reason}
        </span>
      </p>
      <CountdownChip key={impersonation.impersonationId} expiresAt={impersonation.expiresAt} />
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-amber-700/60 bg-amber-100/60 text-xs font-semibold text-amber-950 hover:bg-amber-200/80 hover:text-amber-950 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-50 dark:hover:bg-amber-500/30 dark:hover:text-amber-50"
        onClick={() => endImpersonation.mutate(impersonation.impersonationId)}
        disabled={endImpersonation.isPending}
      >
        {endImpersonation.isPending ? 'Encerrando…' : 'Encerrar agora'}
      </Button>
    </div>
  )
}

// ─── Banner de trial do tenant (Onda 5 / Fase 24) ─────────────────────────────

/**
 * Faixa fina com os dias restantes do trial (âmbar) ou o estado vencido
 * (vermelho/destructivo — leitura liberada, gravação bloqueada pelo servidor
 * com 403 TRIAL_EXPIRED). Atualiza o contador a cada 60s; some para papéis
 * platform_* e tenants sem trial (bootstrap.tenant.trialEndsAt).
 */
function TrialBanner() {
  const bootstrap = useApp((s) => s.bootstrap)
  const actor = useApp((s) => s.actor)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const trialEndsAt = bootstrap?.tenant?.trialEndsAt ?? null
  const isPlatform =
    actor?.role === 'platform_owner' || actor?.role === 'platform_support'
  if (!trialEndsAt || !actor || isPlatform) return null

  const msLeft = new Date(trialEndsAt).getTime() - now
  const daysLeft = Math.ceil(msLeft / 86_400_000)

  if (msLeft > 0) {
    return (
      <div
        role="status"
        aria-label={`Trial termina em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}`}
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-amber-600/50 bg-amber-400/20 px-3 py-1 text-[11px] font-semibold leading-snug text-amber-900 backdrop-blur dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200 sm:px-4 sm:text-xs"
      >
        <Hourglass className="size-3 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <p className="min-w-0">
          Trial termina em {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} — falar com a plataforma
        </p>
      </div>
    )
  }

  return (
    <div
      role="alert"
      aria-label="Trial expirado"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-rose-700/60 bg-rose-600/20 px-3 py-1 text-[11px] font-semibold leading-snug text-rose-100 backdrop-blur dark:border-rose-500/60 dark:bg-rose-600/25 dark:text-rose-100 sm:px-4 sm:text-xs"
    >
      <ShieldAlert className="size-3 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
      <p className="min-w-0">Trial expirado — leitura liberada, gravação bloqueada</p>
    </div>
  )
}

function NotificationsBell() {
  const qc = useQueryClient()
  const setModule = useApp((s) => s.setModule)
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.listNotifications({ limit: 30 }),
    refetchInterval: 30_000,
  })

  // Refresh imediato quando chegar notification.new por realtime
  useRealtime({
    'notification.new': () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('Notificações marcadas como lidas', { description: `${res.updated} item(ns).` })
    },
  })

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações (${unreadCount} não lidas)`}>
          <Bell className="size-4.5" />
          {unreadCount > 0 && (
            <Badge className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold tabular-nums text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <BellRing className="size-4 text-primary" aria-hidden /> Notificações
            {unreadCount > 0 && (
              <Badge className="bg-rose-600 text-[10px] text-white tabular-nums">{unreadCount} nova(s)</Badge>
            )}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || unreadCount === 0}
          >
            <CheckCheck className="size-3.5" /> Marcar todas como lidas
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto custom-scroll">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação por aqui. Sessões, votações, tarefas e webhooks avisarão você.
            </p>
          ) : (
            <ul>
              {notifications.map((n) => {
                const target = n.module && (MODULE_IDS as readonly string[]).includes(n.module)
                  ? (n.module as ModuleId)
                  : null
                return (
                  <li key={n.id} className="border-b last:border-0">
                    <button
                      className={cn(
                        'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-accent',
                        !n.readAt && 'bg-primary/5'
                      )}
                      onClick={() => {
                        if (!n.readAt) markRead.mutate(n.id)
                        if (target) {
                          setModule(target)
                          setOpen(false)
                        }
                      }}
                    >
                      <span
                        className={cn(
                          'mt-0.5 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                          KIND_ICON_COLOR[n.kind] ?? KIND_ICON_COLOR.system
                        )}
                        aria-label={`Tipo: ${NOTIFICATION_KIND_LABEL[n.kind]}`}
                      >
                        {NOTIFICATION_KIND_LABEL[n.kind] ?? n.kind}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn('truncate text-sm', n.readAt ? 'font-medium' : 'font-bold')}>
                            {n.title}
                          </span>
                          {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-rose-600" aria-label="Não lida" />}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">
                          {n.body}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {new Date(n.createdAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {n.targetRole ? ` · para: ${ROLE_LABEL[n.targetRole]}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { theme, setTheme } = useTheme()
  const bootstrap = useApp((s) => s.bootstrap)
  const actor = useApp((s) => s.actor)
  const setActor = useApp((s) => s.setActor)
  const setModule = useApp((s) => s.setModule)
  const connection = useApp((s) => s.connection)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Sair (Fase 9): revoga a sessão httpOnly no servidor (se houver), limpa o
  // ator demo (localStorage + estado persistido) e recarrega — o gate de
  // entrada (login + perfis demo) volta a aparecer.
  async function doLogout() {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // logout é best-effort: a limpeza local acontece de qualquer forma
    }
    useApp.getState().clearActor()
    localStorage.removeItem('legis-app') // estado persistido do zustand (actorId)
    window.location.reload()
  }

  const { data: live } = useQuery({
    queryKey: ['live-session'],
    queryFn: () => api.listSessions(),
    refetchInterval: 30000,
    select: (d) =>
      d.sessions.find((s) => ['open', 'resumed', 'suspended', 'check_in'].includes(s.status)) ?? null,
  })

  const tenant = bootstrap?.tenant

  // Sticky único empilha banner de impersonação (quando ativo) + header — o
  // banner nunca fica para trás na rolagem e aparece em TODOS os módulos.
  return (
    <div className="sticky top-0 z-30 print:hidden">
      <ImpersonationBanner />
      <header className="flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Abrir menu">
        <Menu className="size-5" />
      </Button>

      {/* Instituição operadora; a marca do produto fica na navegação. */}
      <div className="flex min-w-0 items-center gap-2.5">
        {tenant?.logoUrl
          ? <TenantCrest logoUrl={tenant.logoUrl} name={tenant.name} className="size-9" />
          : <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden><Landmark className="size-4" /></div>}
        <div className="min-w-0 leading-tight">
          <p className="truncate font-serif text-sm font-bold sm:text-base">{tenant?.name ?? 'edocBR Plenário'}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {tenant ? `${tenant.city} · ${tenant.uf} · Plano ${tenant.plan}` : 'Carregando…'}
          </p>
        </div>
      </div>

      <div className="flex-1" />

      {/* Pesquisa global (⌘K) — Fase 13 */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="hidden items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground md:inline-flex"
        aria-label="Pesquisar (Ctrl+K)"
      >
        <Search className="size-3.5" aria-hidden />
        <span>Pesquisar</span>
        <kbd className="pointer-events-none rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setPaletteOpen(true)}
        aria-label="Pesquisar"
      >
        <Search className="size-4.5" />
      </Button>

      {/* Sessão ao vivo */}
      {live && (
        <button
          onClick={() => setModule('plenary')}
          className="hidden items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 md:inline-flex"
          title="Ir para a mesa do plenário"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
          </span>
          <Radio className="size-3.5" aria-hidden />
          {live.status === 'check_in' ? 'Credenciamento' : 'Sessão ao vivo'} · {SESSION_STATUS_LABEL[live.status]}
        </button>
      )}

      <span className="hidden sm:inline-flex">
        <ConnectionBadge state={connection} />
      </span>

      {/* Sino de notificações (Fase 6) */}
      <NotificationsBell />

      {/* Tema */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label="Alternar tema claro/escuro"
      >
        <Sun className="size-4 dark:hidden" />
        <Moon className="hidden size-4 dark:block" />
      </Button>

      {/* Troca de perfil exclusiva do ambiente de demonstração. */}
      {bootstrap?.demoMode ? <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 gap-2 px-2.5">
            <span
              className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary"
              aria-hidden
            >
              {(actor?.name ?? '?')
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="hidden max-w-36 truncate text-sm font-medium sm:inline">{actor?.name ?? 'Selecionar perfil'}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Perfil de acesso (RBAC demo) — mudar perfil muda as permissões server-side
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(bootstrap?.actors ?? []).map((a) => (
            <DropdownMenuItem
              key={a.id}
              onClick={() => setActor(a.id, a)}
              className={cn('gap-2', actor?.id === a.id && 'bg-accent')}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary" aria-hidden>
                {a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {ROLE_LABEL[a.role]}{a.jobTitle ? ` · ${a.jobTitle}` : ''}
                </span>
              </span>
              {actor?.id === a.id && <Badge className="ml-1 bg-emerald-600 text-[10px]">Ativo</Badge>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu> : <span className="hidden max-w-44 truncate text-sm font-medium sm:inline" aria-label="Usuário autenticado">
        {actor?.name ?? 'Acesso institucional'}
      </span>}

      {/* Sair (Fase 9) — encerra a sessão autenticada por senha */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirmLogout(true)}
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="size-4" />
      </Button>

      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair da sessão?</AlertDialogTitle>
            <AlertDialogDescription>
              A sessão autenticada por senha será encerrada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doLogout()}>Sair</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Command palette (⌘K) — Fase 13 */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </header>
      {/* Banner de trial (Fase 24) — faixa fina abaixo do header, some para platform_* */}
      <TrialBanner />
    </div>
  )
}
