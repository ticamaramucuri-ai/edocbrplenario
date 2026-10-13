'use client'

/**
 * MÓDULO 2 — Telão do Plenário (modo kiosk, fullscreen sem chrome).
 *
 * Dados: api.publicLive (refetch 10s) + socket público (connectPublicSocket)
 * com dedup por eventId e refetch com debounce de 300ms.
 * Comandos da mesa (display.command): freeze / unfreeze / clear / profile.
 * Snapshot do último estado por Câmara em localStorage para reconstrução após reinício.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Pin, X } from 'lucide-react'

import { api } from '@/lib/api-client'
import type { PublicLiveViewExt } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { connectPublicSocket } from '@/hooks/use-realtime'
import type { RealtimeEvent } from '@/lib/contracts'
import { DISPLAY_PROFILE_LABEL, ProfileView, type DisplayProfile } from './profiles'
import { fmtClock, useNow } from './tick'
import { TenantCrest } from '@/components/brand/brand-logo'
import { readDisplaySnapshot, writeDisplaySnapshot } from './snapshot'
import { shouldAdoptDisplayState, type DisplayMode } from '@/lib/display-state'

/** Remove os dados da sessão mantendo identidade do tenant (comando clear). */
function clearedView(view: PublicLiveViewExt | null): PublicLiveViewExt | null {
  if (!view) return null
  return {
    tenant: view.tenant,
    session: null,
    transmissionLink: null,
    localReplay: null,
    presentMembers: [],
    agenda: [],
    currentVoting: null,
    lastResults: [],
    speakingNow: null,
    displayState: view.displayState,
  }
}

export default function DisplayModule() {
  const setModule = useApp((s) => s.setModule)
  const setDisplayFrozen = useApp((s) => s.setDisplayFrozen)
  const slug = useApp((s) => s.bootstrap?.tenant.slug ?? null)
  const tenantId = useApp((s) => s.bootstrap?.tenant.id ?? null)

  const queryClient = useQueryClient()
  const [snapshotTenantId, setSnapshotTenantId] = useState<string | null>(null)
  const [heldView, setHeldView] = useState<PublicLiveViewExt | null>(null)
  const [manualProfile, setManualProfile] = useState<DisplayProfile | null>(null)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('live')
  const displayVersionRef = useRef(0)
  const displaySessionRef = useRef<string | null>(null)

  const now = useNow(1000)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const restored = tenantId ? readDisplaySnapshot(localStorage, tenantId) : null
      setSnapshotTenantId(tenantId)
      setHeldView(restored?.view ?? null)
      setManualProfile(restored?.manualProfile ?? null)
      // Revalida o quadro congelado no servidor até quando o cache local traz a mesma versão.
      displayVersionRef.current = restored?.mode === 'frozen' ? 0 : restored?.displayVersion ?? 0
      displaySessionRef.current = restored?.sessionId ?? null
      setDisplayMode(restored?.mode ?? 'live')
      setDisplayFrozen(restored?.mode === 'frozen')
    })
    return () => { cancelled = true }
  }, [tenantId, setDisplayFrozen])

  const { data } = useQuery({
    queryKey: ['public-live', slug],
    queryFn: () => api.publicLive(slug ?? ''),
    enabled: !!slug,
    refetchInterval: 10_000,
  })

  // Último dado ao vivo para capturar no congelamento/limpeza (refs só em callbacks/efeitos).
  const liveRef = useRef<PublicLiveViewExt | null>(null)
  useEffect(() => { liveRef.current = null }, [tenantId])
  useEffect(() => {
    liveRef.current = data ?? liveRef.current
  }, [data])

  useEffect(() => {
    if (!data || !tenantId || snapshotTenantId !== tenantId) return
    let cancelled = false
    const state = data.displayState
    const sessionId = data.session?.id ?? null
    if (state && state.sessionId === sessionId) {
      if (!shouldAdoptDisplayState(displaySessionRef.current, displayVersionRef.current, state)) return
      queueMicrotask(async () => {
        if (cancelled) return
        if (!shouldAdoptDisplayState(displaySessionRef.current, displayVersionRef.current, state)) return
        let frozenFrame: PublicLiveViewExt | null = null
        if (state.mode === 'frozen' && state.frozenFrameSha256) {
          if (!slug) return
          try {
            const response = await api.publicDisplayFrame(slug, sessionId, state.version)
            if (response.sessionId !== sessionId || response.version !== state.version || response.sha256 !== state.frozenFrameSha256) return
            frozenFrame = response.frame
          } catch {
            // Mantém a versão anterior e tenta de novo no próximo refetch.
            return
          }
        }
        if (cancelled || !shouldAdoptDisplayState(displaySessionRef.current, displayVersionRef.current, state)) return
        const sameSession = displaySessionRef.current === sessionId
        displaySessionRef.current = sessionId
        displayVersionRef.current = state.version
        if (state.mode === 'frozen') setHeldView((prev) => frozenFrame ?? (sameSession && displayMode === 'frozen' && prev ? prev : (liveRef.current ?? data)))
        if (state.mode === 'cleared') setHeldView(clearedView(liveRef.current ?? data))
        setDisplayMode(state.mode)
        setManualProfile(state.manualProfile)
        setDisplayFrozen(state.mode === 'frozen')
      })
    } else if (displaySessionRef.current !== sessionId || displayVersionRef.current > 0 || displayMode !== 'live' || manualProfile !== null) {
      queueMicrotask(() => {
        if (cancelled) return
        displaySessionRef.current = sessionId
        displayVersionRef.current = 0
        setDisplayMode('live')
        setHeldView(null)
        setManualProfile(null)
        setDisplayFrozen(false)
      })
    }
    return () => { cancelled = true }
  }, [data, tenantId, slug, snapshotTenantId, displayMode, manualProfile, setDisplayFrozen])

  // Visão efetiva: congelado/limpo → snapshot retido; senão → dados ao vivo
  // (com fallback ao snapshot restaurado até o primeiro fetch).
  const safeHeldView = snapshotTenantId === tenantId ? heldView : null
  const safeManualProfile = snapshotTenantId === tenantId ? manualProfile : null
  const pendingFrozen = data?.displayState?.mode === 'frozen' && displayMode !== 'frozen'
  const view = pendingFrozen
    ? (safeHeldView?.session?.id === data?.session?.id ? safeHeldView : null)
    : displayMode === 'frozen' || displayMode === 'cleared' ? safeHeldView : (data ?? safeHeldView)

  // Persiste o snapshot para reconstrução após reinício.
  useEffect(() => {
    if (!tenantId || snapshotTenantId !== tenantId) return
    try {
      writeDisplaySnapshot(localStorage, {
        tenantId, view, manualProfile: safeManualProfile,
        sessionId: displaySessionRef.current, displayVersion: displayVersionRef.current, mode: displayMode,
      })
    } catch {
      // localStorage indisponível — o telão reconstrói pelo primeiro fetch
    }
  }, [tenantId, snapshotTenantId, view, safeManualProfile, displayMode])

  // ESC sai do telão de volta à mesa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModule('plenary')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setModule])

  // Socket público: eventos → refetch. A API versionada é a fonte do estado visual.
  useEffect(() => {
    if (!tenantId) return
    const socket = connectPublicSocket(tenantId)
    let seen = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['public-live', slug] })
      }, 300)
    }

    socket.on('subscribed', (subscription: { tenantId?: string; scope?: string }) => {
      if (subscription.tenantId === tenantId && subscription.scope === 'public') scheduleRefetch()
    })

    socket.onAny((eventType: string, event: RealtimeEvent) => {
      if (!event || typeof event !== 'object' || !('eventId' in event)) return
      if (seen.has(event.eventId)) return
      seen.add(event.eventId)
      if (seen.size > 800) seen = new Set(Array.from(seen).slice(-400))

      if (eventType === 'display.command') {
        scheduleRefetch()
        return
      }
      scheduleRefetch()
    })

    return () => {
      if (timer) clearTimeout(timer)
      socket.disconnect()
    }
  }, [tenantId, slug, queryClient])

  // ─── Perfil ativo: manual (comando da mesa) ou automático ───────────────
  const autoProfile = useMemo<DisplayProfile>(() => {
    if (!view?.session) return 'boas_vindas'
    const voting = view.currentVoting
    if (voting && (voting.status === 'open' || voting.status === 'paused')) return 'votacao'
    if (view.speakingNow) return 'discurso'
    if (view.session.status === 'check_in') return 'presenca'
    if (view.session.status === 'closed' || view.session.status === 'cancelled') return 'encerramento'
    return 'pauta'
  }, [view])

  const profile = safeManualProfile ?? autoProfile
  const primary = view?.tenant.primaryColor ?? '#062f63'
  const accent = view?.tenant.accentColor ?? '#d9a441'
  const session = view?.session ?? null
  const live = session?.status === 'open' || session?.status === 'resumed'
  const clock = fmtClock(now)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-50">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-8 sm:py-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {view?.tenant.logoUrl
            ? <TenantCrest logoUrl={view.tenant.logoUrl} name={view.tenant.name} className="size-10 rounded bg-white p-0.5 sm:size-12" />
            : <Landmark className="size-8 shrink-0 sm:size-10" style={{ color: accent }} aria-hidden />}
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-bold sm:text-2xl lg:text-3xl">
              {view?.tenant.name ?? 'Câmara Municipal'}
            </p>
            <p className="truncate text-xs text-zinc-400 sm:text-sm">
              {view?.tenant ? `${view.tenant.city} · ${view.tenant.uf}` : 'Painel do plenário'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:gap-6">
          {session && (
            <div className="hidden max-w-xs text-right sm:block">
              <p className="truncate text-sm font-semibold text-zinc-200 sm:text-base">{session.label}</p>
              <p className="flex items-center justify-end gap-2 text-xs text-zinc-400">
                {live && (
                  <span className="flex items-center gap-1.5 font-bold text-emerald-400" role="status">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                      <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                    </span>
                    AO VIVO
                  </span>
                )}
                <span>{session.statusLabel}</span>
              </p>
            </div>
          )}
          <p className="font-mono text-xl font-bold tabular-nums sm:text-3xl" aria-label={`Relógio: ${clock}`}>
            {clock}
          </p>
          <button
            type="button"
            onClick={() => setModule('plenary')}
            aria-label="Sair do telão e voltar à mesa do plenário"
            title="Sair do telão (Esc)"
            className="flex size-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      {(displayMode === 'frozen' || pendingFrozen) && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-center text-sm font-bold uppercase tracking-widest text-amber-300"
        >
          <Pin className="size-4" aria-hidden /> Tela congelada — comandos da mesa
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col">
        <ProfileView profile={profile} view={view} primary={primary} accent={accent} now={now} />
      </main>

      {safeManualProfile && (
        <p className="pointer-events-none fixed bottom-3 right-3 rounded-full border border-amber-500/40 bg-zinc-950/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
          Perfil fixado: {DISPLAY_PROFILE_LABEL[safeManualProfile]}
        </p>
      )}
    </div>
  )
}
