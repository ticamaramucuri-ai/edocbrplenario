'use client'

/**
 * MÓDULO 2 — Telão do Plenário (modo kiosk, fullscreen sem chrome).
 *
 * Dados: api.publicLive (refetch 10s) + socket público (connectPublicSocket)
 * com dedup por eventId e refetch com debounce de 300ms.
 * Comandos da mesa (display.command): freeze / unfreeze / clear / profile.
 * Snapshot do último estado em localStorage para reconstrução após reinício.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const SNAPSHOT_KEY = 'legis.display.snapshot'

type Snapshot = { view: PublicLiveViewExt | null; manualProfile: DisplayProfile | null }

function loadSnapshot(): Snapshot {
  if (typeof window === 'undefined') return { view: null, manualProfile: null }
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return { view: null, manualProfile: null }
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    return {
      view: parsed.view ?? null,
      manualProfile: parsed.manualProfile ?? null,
    }
  } catch {
    return { view: null, manualProfile: null }
  }
}

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
  }
}

type CommandPayload = { action?: string; profile?: DisplayProfile }

export default function DisplayModule() {
  const setModule = useApp((s) => s.setModule)
  const setDisplayFrozen = useApp((s) => s.setDisplayFrozen)
  const slug = useApp((s) => s.bootstrap?.tenant.slug ?? null)
  const tenantId = useApp((s) => s.bootstrap?.tenant.id ?? null)

  const queryClient = useQueryClient()
  const [snapshot] = useState<Snapshot>(() => loadSnapshot())
  const [heldView, setHeldView] = useState<PublicLiveViewExt | null>(snapshot.view)
  const [manualProfile, setManualProfile] = useState<DisplayProfile | null>(snapshot.manualProfile)
  const [frozen, setFrozen] = useState(false)
  const [cleared, setCleared] = useState(false)

  const now = useNow(1000)

  const { data } = useQuery({
    queryKey: ['public-live'],
    queryFn: () => api.publicLive(slug ?? ''),
    enabled: !!slug,
    refetchInterval: 10_000,
  })

  // Último dado ao vivo para capturar no congelamento/limpeza (refs só em callbacks/efeitos).
  const liveRef = useRef<PublicLiveViewExt | null>(null)
  useEffect(() => {
    liveRef.current = data ?? liveRef.current
  }, [data])

  // Visão efetiva: congelado/limpo → snapshot retido; senão → dados ao vivo
  // (com fallback ao snapshot restaurado até o primeiro fetch).
  const view = frozen || cleared ? heldView : (data ?? heldView)

  // Persiste o snapshot para reconstrução após reinício.
  useEffect(() => {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ view, manualProfile }))
    } catch {
      // localStorage indisponível — o telão reconstrói pelo primeiro fetch
    }
  }, [view, manualProfile])

  // ESC sai do telão de volta à mesa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModule('plenary')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setModule])

  const applyCommand = useCallback(
    (payload: CommandPayload) => {
      if (payload?.action === 'freeze') {
        // Congela o telão no estado atual (último dado ao vivo ou retido).
        setHeldView((prev) => liveRef.current ?? prev)
        setFrozen(true)
        setCleared(false)
        setDisplayFrozen(true)
        return
      }
      if (payload?.action === 'unfreeze') {
        setFrozen(false)
        setCleared(false)
        setDisplayFrozen(false)
        return
      }
      if (payload?.action === 'clear') {
        setHeldView((prev) => clearedView(liveRef.current ?? prev))
        setFrozen(false)
        setDisplayFrozen(false)
        setCleared(true)
        setManualProfile('boas_vindas')
        return
      }
      if (payload?.action === 'profile' && payload.profile) {
        setFrozen(false)
        setDisplayFrozen(false)
        setCleared(false)
        setManualProfile(payload.profile)
      }
    },
    [setDisplayFrozen]
  )

  // Socket público: eventos → refetch com debounce; display.command → controle.
  useEffect(() => {
    if (!tenantId) return
    const socket = connectPublicSocket(tenantId)
    let seen = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['public-live'] })
      }, 300)
    }

    socket.onAny((eventType: string, event: RealtimeEvent) => {
      if (!event || typeof event !== 'object' || !('eventId' in event)) return
      if (seen.has(event.eventId)) return
      seen.add(event.eventId)
      if (seen.size > 800) seen = new Set(Array.from(seen).slice(-400))

      if (eventType === 'display.command') {
        applyCommand(event.payload as CommandPayload)
        return
      }
      scheduleRefetch()
    })

    return () => {
      if (timer) clearTimeout(timer)
      socket.disconnect()
    }
  }, [tenantId, queryClient, applyCommand])

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

  const profile = manualProfile ?? autoProfile
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

      {frozen && (
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

      {manualProfile && (
        <p className="pointer-events-none fixed bottom-3 right-3 rounded-full border border-amber-500/40 bg-zinc-950/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
          Perfil fixado: {DISPLAY_PROFILE_LABEL[manualProfile]}
        </p>
      )}
    </div>
  )
}
