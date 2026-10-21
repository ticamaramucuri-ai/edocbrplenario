/**
 * Hook de tempo real — socket.io via gateway Caddy (/?XTransformPort=3003) ou
 * pela URL de `NEXT_PUBLIC_REALTIME_URL` quando não há gateway.
 * Deduplicação por eventId; reconexão exponencial; status sempre visível.
 *
 * Singleton: todos os consumidores compartilham um socket interno; handlers
 * são registrados num registry module-level e sempre lêem closures atualizadas.
 */
'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import type { RealtimeEvent, RealtimeEventType } from '@/lib/contracts'
import { ATRASO_INDISPONIVEL_MS, realtimeEndpoint } from '@/lib/realtime-endpoint'
import { useApp } from '@/lib/store'

/**
 * Acesso estático às variáveis — o Next substitui `process.env.NEXT_PUBLIC_*`
 * no build por texto, então não dá para repassar `process.env` inteiro.
 */
function endpointDoAmbiente(): string {
  return realtimeEndpoint({
    NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
    NEXT_PUBLIC_REALTIME_GATEWAY: process.env.NEXT_PUBLIC_REALTIME_GATEWAY,
  })
}

type Handler = (event: RealtimeEvent) => void
type HandlerMap = Partial<Record<RealtimeEventType, Handler>>

const registry = new Map<string, HandlerMap>()
const socketState: { socket: Socket | null; tenantId: string | null; actorId: string | null; refCount: number; seen: Set<string>; vigia: ReturnType<typeof setTimeout> | null } = {
  socket: null,
  tenantId: null,
  actorId: null,
  refCount: 0,
  seen: new Set(),
  vigia: null,
}

/**
 * Sem gateway nem URL explícita a conexão nunca se estabelece e o estado ficava
 * em "Conectando…" indefinidamente. Depois de 15 s sem entrar na sala, o estado
 * passa a `unavailable`, que a topbar exibe nomeando a causa provável.
 */
function armarVigiaDeIndisponibilidade(): void {
  if (socketState.vigia) clearTimeout(socketState.vigia)
  socketState.vigia = setTimeout(() => {
    socketState.vigia = null
    if (useApp.getState().connection !== 'online') useApp.getState().setConnection('unavailable')
  }, ATRASO_INDISPONIVEL_MS)
}

function desarmarVigiaDeIndisponibilidade(): void {
  if (!socketState.vigia) return
  clearTimeout(socketState.vigia)
  socketState.vigia = null
}

function ensureSocket(tenantId: string, actorId: string, queryClient: QueryClient): Socket {
  if (socketState.socket && socketState.tenantId === tenantId && socketState.actorId === actorId) return socketState.socket

  socketState.socket?.disconnect()
  armarVigiaDeIndisponibilidade()
  const socket = io(endpointDoAmbiente(), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 12000,
    auth: async (callback) => {
      try {
        const headers = new Headers()
        const actorId = localStorage.getItem('legis.actorId')
        if (actorId) headers.set('x-actor-id', actorId)
        const response = await fetch('/api/v1/realtime/token', {
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Falha ao autorizar tempo real')
        const body = await response.json() as { token: string }
        callback({ tenantId, scope: 'internal', token: body.token })
      } catch {
        callback({ tenantId, scope: 'internal', token: '' })
      }
    },
  })
  socketState.socket = socket
  socketState.tenantId = tenantId
  socketState.actorId = actorId
  socketState.seen = new Set()

  const { setConnection, markEvent } = useApp.getState()

  socket.on('connect', () => {
    setConnection('connecting')
  })
  socket.on('subscribed', (subscription: { tenantId?: string; scope?: string }) => {
    if (subscription.tenantId === tenantId && subscription.scope === 'internal') {
      desarmarVigiaDeIndisponibilidade()
      useApp.getState().setConnection('online')
      // O outbox sinaliza mudanças, mas pode haver lacuna durante uma queda.
      // Releia as consultas ativas sempre que a sala for restabelecida.
      void queryClient.invalidateQueries({ refetchType: 'active' })
    }
  })
  socket.on('subscribe_error', () => {
    desarmarVigiaDeIndisponibilidade()
    useApp.getState().setConnection('offline')
  })
  socket.on('disconnect', (reason) => {
    desarmarVigiaDeIndisponibilidade()
    useApp.getState().setConnection('offline')
    if (reason === 'io server disconnect') socket.connect()
  })
  socket.io.on('reconnect_attempt', () => {
    // `unavailable` já é um diagnóstico; tentativa de reconexão não o apaga.
    if (useApp.getState().connection !== 'unavailable') useApp.getState().setConnection('reconnecting')
  })
  socket.on('connect_error', () => {
    const st = useApp.getState().connection
    if (st !== 'reconnecting' && st !== 'unavailable') useApp.getState().setConnection('reconnecting')
  })

  socket.onAny((eventType: string, event: RealtimeEvent) => {
    if (!event || typeof event !== 'object' || !('eventId' in event)) return
    if (socketState.seen.has(event.eventId)) return
    socketState.seen.add(event.eventId)
    if (socketState.seen.size > 800) {
      socketState.seen = new Set(Array.from(socketState.seen).slice(-400))
    }
    markEvent()
    for (const handlers of registry.values()) {
      const h = handlers[eventType as RealtimeEventType]
      if (h) h(event)
    }
  })

  return socket
}

export function useRealtime(handlers: HandlerMap) {
  const queryClient = useQueryClient()
  const tenantId = useApp((s) => s.bootstrap?.tenant.id ?? null)
  const actorId = useApp((s) => s.actorId)
  const idRef = useRef<string>(`h${Math.random().toString(36).slice(2)}`)

  // Sempre atualiza as closures mais recentes no registry
  registry.set(idRef.current, handlers)

  useEffect(() => {
    if (!tenantId || !actorId) return
    const socket = ensureSocket(tenantId, actorId, queryClient)
    socketState.refCount += 1

    return () => {
      socketState.refCount -= 1
      registry.delete(idRef.current)
      if (socketState.refCount <= 0) {
        socketState.socket?.disconnect()
        socketState.socket = null
        socketState.tenantId = null
        socketState.actorId = null
        socketState.refCount = 0
        desarmarVigiaDeIndisponibilidade()
      }
    }
  }, [tenantId, actorId, queryClient])
}

/** Assinatura pública (portal/telão) — instância independente */
export function connectPublicSocket(tenantId: string): Socket {
  const s = io(endpointDoAmbiente(), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    auth: { tenantId, scope: 'public' },
  })
  s.on('connect', () => {
    s.emit('subscribe', { tenantId, scope: 'public' })
  })
  return s
}
