import type { DisplayProfile } from '@/modules/display/profiles'

export type DisplayMode = 'live' | 'frozen' | 'cleared'
export type DisplayStateView = {
  sessionId: string
  version: number
  mode: DisplayMode
  manualProfile: DisplayProfile | null
  frozenFrameSha256: string | null
}

export type DisplayAction = 'freeze' | 'unfreeze' | 'clear' | 'publish' | 'profile'

export function displayStateChange(action: DisplayAction, profile?: DisplayProfile) {
  if (action === 'freeze') return { mode: 'frozen' as const }
  if (action === 'unfreeze') return { mode: 'live' as const }
  if (action === 'clear') return { mode: 'cleared' as const, manualProfile: 'boas_vindas' as const }
  if (action === 'profile') {
    if (!profile) throw new Error('Perfil do telão obrigatório.')
    return { mode: 'live' as const, manualProfile: profile }
  }
  return { mode: 'live' as const }
}

export function parseDisplayState(row: { sessionId: string; version: number; mode: string; manualProfile: string | null; frozenFrameSha256?: string | null } | null): DisplayStateView | null {
  if (!row) return null
  const modes = new Set<DisplayMode>(['live', 'frozen', 'cleared'])
  const profiles = new Set<DisplayProfile>(['boas_vindas', 'presenca', 'pauta', 'votacao', 'discurso', 'encerramento'])
  return {
    sessionId: row.sessionId,
    version: row.version,
    mode: modes.has(row.mode as DisplayMode) ? row.mode as DisplayMode : 'live',
    manualProfile: row.manualProfile && profiles.has(row.manualProfile as DisplayProfile) ? row.manualProfile as DisplayProfile : null,
    frozenFrameSha256: row.mode === 'frozen' ? row.frozenFrameSha256 ?? null : null,
  }
}

export function shouldAdoptDisplayState(currentSessionId: string | null, currentVersion: number, incoming: DisplayStateView): boolean {
  return currentSessionId !== incoming.sessionId || incoming.version > currentVersion
}
