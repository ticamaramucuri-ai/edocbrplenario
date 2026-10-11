'use client'

/**
 * Hook da sessão autenticada (Fase 20) — GET /api/v1/auth/me com polling de 1
 * minuto. Fonte da verdade para o BANNER de impersonação (topbar) e para o
 * módulo de Suporte (saber se há sessão por senha e quem é o ator EFETIVO).
 *
 * - 401 (sem sessão — modo demo x-actor-id) devolve null SEM erro: polling
 *   silencioso, sem toast global (fetch próprio, fora do api-client).
 * - Durante impersonação ativa, `actor` é o USUÁRIO-ALVO e `actor.impersonation`
 *   traz o banner (suporte, motivo, prazo). Expiração é LAZY no servidor: no
 *   primeiro /me após o prazo o ator volta a ser o suporte e o banner some.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ActorView, ImpersonationBannerView } from '@/lib/contracts'

export type MeView = {
  actor: ActorView & {
    email: string
    tenantId: string | null
    impersonation: ImpersonationBannerView | null
  }
  expiresAt: string
}

async function fetchMe(): Promise<MeView | null> {
  try {
    const headers = new Headers()
    const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
    if (actorId) headers.set('x-actor-id', actorId)
    const res = await fetch('/api/v1/auth/me', { headers, credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as MeView
  } catch {
    return null
  }
}

/**
 * Sessão atual (null no modo demo). Polling de 60s — suficiente para o
 * contador do banner (minutos) e para expiração lazy da impersonação.
 */
export function useMe(): UseQueryResult<MeView | null> {
  return useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchMe,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 10_000,
  })
}
