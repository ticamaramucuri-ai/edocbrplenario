import type { PublicLiveViewExt } from '@/lib/api-client'
import type { DisplayProfile } from './profiles'
import type { DisplayMode } from '@/lib/display-state'

export type DisplaySnapshot = {
  tenantId: string
  view: PublicLiveViewExt | null
  manualProfile: DisplayProfile | null
  sessionId: string | null
  displayVersion: number
  mode: DisplayMode
}

const PREFIX = 'legis.display.snapshot.'
const PROFILES = new Set<DisplayProfile>([
  'boas_vindas', 'presenca', 'pauta', 'votacao', 'discurso', 'encerramento',
])

export function emptyDisplaySnapshot(tenantId: string): DisplaySnapshot {
  return { tenantId, view: null, manualProfile: null, sessionId: null, displayVersion: 0, mode: 'live' }
}

export function readDisplaySnapshot(storage: Pick<Storage, 'getItem'>, tenantId: string): DisplaySnapshot {
  try {
    const raw = storage.getItem(`${PREFIX}${tenantId}`)
    if (!raw) return emptyDisplaySnapshot(tenantId)
    const parsed = JSON.parse(raw) as Partial<DisplaySnapshot>
    if (parsed.tenantId !== tenantId) return emptyDisplaySnapshot(tenantId)
    return {
      tenantId,
      view: parsed.view && typeof parsed.view === 'object' ? parsed.view : null,
      manualProfile: parsed.manualProfile && PROFILES.has(parsed.manualProfile) ? parsed.manualProfile : null,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      displayVersion: Number.isSafeInteger(parsed.displayVersion) && Number(parsed.displayVersion) >= 0 ? Number(parsed.displayVersion) : 0,
      mode: parsed.mode === 'frozen' || parsed.mode === 'cleared' ? parsed.mode : 'live',
    }
  } catch {
    return emptyDisplaySnapshot(tenantId)
  }
}

export function writeDisplaySnapshot(storage: Pick<Storage, 'setItem'>, snapshot: DisplaySnapshot): void {
  storage.setItem(`${PREFIX}${snapshot.tenantId}`, JSON.stringify(snapshot))
}
