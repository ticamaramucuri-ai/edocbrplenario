/** Adaptador MediaMTX v1.21.2. Credenciais permanecem somente no arquivo local de segredos. */
import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { DomainError } from './errors'

const destinationSchema = z.object({
  tenantId: z.string().min(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  label: z.string().min(1).max(80),
  platform: z.enum(['youtube', 'facebook', 'instagram', 'other']),
  dest: z.string().startsWith('rtmps://'),
  destFingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
})
type Destination = z.infer<typeof destinationSchema>
type PathConfig = { forward?: Array<{ dest: string }>; record?: boolean }
type ForwardDest = { pos?: number; state?: 'idle' | 'forwarding' | 'error'; outboundBytes?: number }
const pathLocks = new Map<string, Promise<void>>()

async function serializePath<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathLocks.get(path) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  pathLocks.set(path, current)
  await previous
  try { return await operation() }
  finally {
    release()
    if (pathLocks.get(path) === current) pathLocks.delete(path)
  }
}

function unavailable(detail: string): DomainError {
  return new DomainError('MEDIA_CONTROL_UNAVAILABLE', 503, 'Controlador indisponível', detail)
}

export async function loadMediaDestinations(tenantId: string): Promise<Destination[]> {
  const file = process.env.MEDIA_DESTINATIONS_FILE?.trim()
  if (!file) return []
  try {
    const info = await stat(file)
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('permissions')
    const all = z.array(destinationSchema).max(32).parse(JSON.parse(await readFile(file, 'utf8')))
    const keys = all.map((item) => `${item.tenantId}:${item.id}`)
    if (new Set(keys).size !== keys.length || all.some((item) => {
      try { return item.platform !== 'other' && !new URL(item.dest).hash } catch { return true }
    })) throw new Error('invalid destination')
    return all.filter((item) => item.tenantId === tenantId)
  } catch {
    throw unavailable('Arquivo de destinos ausente, inválido ou sem permissões restritas (0600/0400).')
  }
}

function controlUrl(path: string): URL {
  const raw = process.env.MEDIA_CONTROL_URL?.trim()
  if (!raw) throw unavailable('Configure MEDIA_CONTROL_URL para operar os destinos.')
  let url: URL
  try { url = new URL(raw) } catch { throw unavailable('MEDIA_CONTROL_URL inválida.') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw unavailable('MEDIA_CONTROL_URL deve apontar para HTTP em loopback.')
  }
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url
}

async function controlRequest<T>(path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(controlUrl(path), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    // O corpo de erro/configuração pode conter stream keys; nunca propagar nem registrar.
    if (response.status === 404) return { status: 404, data: null }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { status: response.status, data: await response.json() as T }
  } catch {
    throw unavailable('A API local do MediaMTX não respondeu corretamente.')
  }
}

async function pathConfig(path: string): Promise<PathConfig> {
  const result = await controlRequest<PathConfig>(`/v3/config/paths/get/${encodeURIComponent(path)}`)
  if (result.status === 404 || !result.data) {
    throw new DomainError('MEDIA_PATH_NOT_CONFIGURED', 409, 'Caminho não configurado', 'Cadastre o caminho da sessão no MediaMTX antes de operar destinos.')
  }
  if (!Array.isArray(result.data.forward)) throw unavailable('Configuração de encaminhamento inválida no MediaMTX.')
  return result.data
}

export type DestinationView = {
  id: string
  label: string
  platform: Destination['platform']
  enabled: boolean
  state: 'disabled' | 'idle' | 'forwarding' | 'error'
  outboundBytes: number | null
}

export type RecordingView = { configured: boolean; segmentCount: number; latestSegmentAt: string | null }

/** Catálogo de segmentos do MediaMTX; a integridade do arquivo exige verificação separada. */
export async function recordingSnapshot(path: string): Promise<RecordingView> {
  const conf = await pathConfig(path)
  const result = await controlRequest<{ segments?: Array<{ start?: string }> }>(`/v3/recordings/get/${encodeURIComponent(path)}`)
  const segments = Array.isArray(result.data?.segments) ? result.data.segments : []
  const timestamps = segments.map((segment) => segment.start).filter((start): start is string => Boolean(start) && !Number.isNaN(Date.parse(start!)))
  return {
    configured: conf.record === true,
    segmentCount: segments.length,
    latestSegmentAt: timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
  }
}

export async function destinationSnapshot(tenantId: string, path: string): Promise<{ configured: boolean; destinations: DestinationView[] }> {
  const destinations = await loadMediaDestinations(tenantId)
  if (!destinations.length) return { configured: Boolean(process.env.MEDIA_DESTINATIONS_FILE), destinations: [] }
  const conf = await pathConfig(path)
  const forwards = conf.forward ?? []
  const listUrl = controlUrl('/v3/paths/forward-dests/list')
  listUrl.searchParams.set('path', path)
  let runtime: ForwardDest[] = []
  // Chamada de status usa query string; nenhuma URL de destino é retornada ao cliente.
  try {
    const response = await fetch(listUrl, { cache: 'no-store', signal: AbortSignal.timeout(2500) })
    if (response.ok) {
      const body = await response.json() as { items?: ForwardDest[] }
      runtime = Array.isArray(body.items) ? body.items : []
    } else if (response.status !== 404) throw new Error('status')
  } catch { throw unavailable('Estado dos destinos indisponível no MediaMTX.') }
  return {
    configured: true,
    destinations: destinations.map((item) => {
      const pos = forwards.findIndex((forward) => forward.dest === item.dest)
      // A API de runtime numera destinos a partir de 1; o array de configuração começa em 0.
      const active = pos >= 0 ? runtime.find((forward) => forward.pos === pos + 1) : undefined
      return {
        id: item.id,
        label: item.label,
        platform: item.platform,
        enabled: pos >= 0,
        state: pos < 0 ? 'disabled' : active?.state ?? 'idle',
        outboundBytes: active && Number.isSafeInteger(active.outboundBytes) ? active.outboundBytes! : null,
      }
    }),
  }
}

export async function setDestinationEnabled(tenantId: string, path: string, destinationId: string, enabled: boolean): Promise<boolean> {
  return serializePath(path, async () => {
    const item = (await loadMediaDestinations(tenantId)).find((dest) => dest.id === destinationId)
    if (!item) throw new DomainError('MEDIA_DESTINATION_NOT_FOUND', 404, 'Destino não encontrado', 'Destino não está configurado para esta Câmara.')
    const conf = await pathConfig(path)
    const previous = conf.forward ?? []
    const exists = previous.some((forward) => forward.dest === item.dest)
    if (exists === enabled) return false
    const forward = enabled
      ? [...previous, { dest: item.dest, ...(item.destFingerprint ? { destFingerprint: item.destFingerprint } : {}) }]
      : previous.filter((entry) => entry.dest !== item.dest)
    await controlRequest(`/v3/config/paths/patch/${encodeURIComponent(path)}`, 'PATCH', { forward })
    const verified = await pathConfig(path)
    if (verified.forward?.some((entry) => entry.dest === item.dest) !== enabled) {
      throw unavailable('O MediaMTX não confirmou a configuração do destino.')
    }
    return true
  })
}
