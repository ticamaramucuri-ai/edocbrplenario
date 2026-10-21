/**
 * Store global (zustand) — navegação entre módulos, ator demo, bootstrap e status de conexão.
 */
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActorView, BootstrapView, Role } from './contracts'

export type ModuleId =
  | 'dashboard'
  | 'sessions'
  | 'plenary'
  | 'display'
  | 'pwa'
  | 'parliamentarians'
  | 'matters'
  | 'audit'
  | 'reports'
  | 'portal'
  | 'settings'
  | 'structure'
  | 'workflow'
  | 'webhooks'
  | 'console'
  | 'migration'
  // Fases 9–12
  | 'users'
  | 'publications'
  | 'analytics'
  // Fases 13–16
  | 'agenda'
  | 'templates'
  | 'help'
  // Onda 4 — Fases 17–20
  | 'support'
  // v0.12.0 — Planejamento e Roadmap (Onda 5)
  | 'roadmap'
  // Onda 5 — Fases 23–24
  | 'integrations'
  | 'growth'

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'unavailable'

type AppState = {
  // Navegação
  activeModule: ModuleId
  setModule: (m: ModuleId) => void

  // Ator demo (RBAC)
  actorId: string | null
  actor: ActorView | null
  setActor: (id: string, actor: ActorView) => void
  /** Volta ao gate de entrada (login + perfis demo). */
  clearActor: () => void

  // Bootstrap
  bootstrap: BootstrapView | null
  setBootstrap: (b: BootstrapView) => void

  // Sessão em foco (mesa do plenário / telão / relatórios)
  focusSessionId: string | null
  setFocusSession: (id: string | null) => void

  // Tempo real
  connection: ConnectionState
  lastEventAt: string | null
  setConnection: (c: ConnectionState) => void
  markEvent: () => void

  // Telão congelado (comando display)
  displayFrozen: boolean
  setDisplayFrozen: (v: boolean) => void

  // Permissões locais (só para UX; autorização real é server-side).
  // `can` é REATIVO: nova referência a cada troca de ator — componentes que
  // selecionam `s.can` re-renderizam automaticamente.
  can: (action: string) => boolean
}

/** Matriz espelhada de src/lib/server/rbac.ts (apenas para esconder UI) */
const RBAC: Record<string, Role[]> = {
  'tenant.update': ['tenant_admin', 'platform_owner'],
  'parliamentarian.write': ['tenant_admin', 'legislative_admin'],
  'matter.write': ['tenant_admin', 'legislative_admin'],
  'session.create': ['tenant_admin', 'legislative_admin'],
  'session.transition': ['session_operator', 'presiding_officer', 'tenant_admin'],
  'attendance.write': ['session_operator', 'tenant_admin'],
  'voting.write': ['session_operator', 'presiding_officer', 'tenant_admin'],
  'voting.impediment.reason.read': ['session_operator', 'presiding_officer', 'tenant_admin', 'legislative_admin', 'auditor', 'platform_owner'],
  'vote.cast': ['session_operator', 'presiding_officer', 'parliamentarian'],
  'speech.write': ['session_operator', 'tenant_admin'],
  'display.command': ['session_operator', 'tenant_admin'],
  'media.read': ['media_operator', 'session_operator', 'tenant_admin'],
  'media.manage': ['media_operator', 'session_operator', 'tenant_admin'],
  'audit.read': ['auditor', 'tenant_admin', 'platform_owner'],
  'structure.write': ['tenant_admin', 'legislative_admin'],
  'protocol.write': ['tenant_admin', 'legislative_admin'],
  'task.write': ['tenant_admin', 'legislative_admin', 'session_operator'],
  'webhook.manage': ['tenant_admin'],
  'notification.broadcast': ['tenant_admin'],
  // Fase 7 — IA assistiva & app do parlamentar
  'ai.use': ['tenant_admin', 'legislative_admin', 'session_operator', 'presiding_officer'],
  'ai.review': ['tenant_admin', 'legislative_admin'],
  'self.attendance': ['parliamentarian'],
  'self.vote': ['parliamentarian'],
  'self.speech': ['parliamentarian'],
  // Fases 8–12 — console, migração, usuários, publicações, analytics
  'platform.manage': ['platform_owner'],
  'migration.manage': ['tenant_admin', 'legislative_admin', 'platform_owner'],
  'user.manage': ['tenant_admin', 'platform_owner'],
  'publication.write': ['tenant_admin', 'legislative_admin'],
  'hearing.write': ['tenant_admin', 'legislative_admin'],
  'analytics.read': [
    'tenant_admin',
    'legislative_admin',
    'session_operator',
    'presiding_officer',
    'parliamentarian',
    'auditor',
    'platform_owner',
  ],
  // Fases 13–16 — agenda/pesquisa/ajuda são leitura para qualquer papel autenticado
  'template.write': ['tenant_admin', 'legislative_admin'],
  // Onda 4 — Fases 17–20
  'subscription.manage': ['tenant_admin', 'legislative_admin'],
  'platform.read': ['platform_owner', 'platform_support'],
  'impersonation.manage': ['platform_owner', 'platform_support'],
  // Onda 5 — Fase 23: chaves de API (emissão/revogação pelo admin do tenant)
  'apikey.manage': ['tenant_admin'],
}

function makeCan(role: Role | undefined): (action: string) => boolean {
  return (action: string) => (role ? (RBAC[action] ?? []).includes(role) : false)
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      activeModule: 'dashboard',
      setModule: (m) => set({ activeModule: m }),

      actorId: null,
      actor: null,
      setActor: (id, actor) => {
        localStorage.setItem('legis.actorId', id)
        set({ actorId: id, actor, can: makeCan(actor.role) })
      },
      clearActor: () => {
        localStorage.removeItem('legis.actorId')
        set({ actorId: null, actor: null, can: makeCan(undefined) })
      },

      bootstrap: null,
      setBootstrap: (b) => {
        const currentActorId = get().actorId
        const actor = b.actors.find((a) => a.id === currentActorId) ?? null
        set({ bootstrap: b, actor, can: makeCan(actor?.role) })
      },

      focusSessionId: null,
      setFocusSession: (id) => set({ focusSessionId: id }),

      connection: 'connecting',
      lastEventAt: null,
      setConnection: (c) => set({ connection: c }),
      markEvent: () => set({ lastEventAt: new Date().toISOString() }),

      displayFrozen: false,
      setDisplayFrozen: (v) => set({ displayFrozen: v }),

      can: makeCan(undefined),
    }),
    {
      name: 'legis-app',
      partialize: (s) => ({ actorId: s.actorId, activeModule: s.activeModule, focusSessionId: s.focusSessionId }),
    }
  )
)
