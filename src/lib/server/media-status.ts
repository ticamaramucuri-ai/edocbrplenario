/** Estado operacional local. Nenhum valor implica confirmação de rede social. */
export type TransmissionStatus = 'draft' | 'ready' | 'monitoring' | 'ended'
export type TransmissionAction = 'prepare' | 'start_monitoring' | 'stop_monitoring'

export const NEXT_STATUS: Record<TransmissionAction, Partial<Record<TransmissionStatus, TransmissionStatus>>> = {
  prepare: { draft: 'ready' },
  start_monitoring: { ready: 'monitoring' },
  stop_monitoring: { monitoring: 'ended' },
}

export function nextTransmissionStatus(
  status: TransmissionStatus,
  action: TransmissionAction,
  sourceReady: boolean
): TransmissionStatus | null {
  const next = NEXT_STATUS[action][status]
  if (!next) return null
  if (action === 'start_monitoring' && !sourceReady) return null
  return next
}

export type SourceProbe = {
  configured: boolean
  ready: boolean
  path: string
  checkedAt: string
  inboundBytes: number | null
  error: string | null
}

export function parseMediaMetrics(metrics: string, path: string): { ready: boolean; inboundBytes: number | null } {
  const statePrefix = `paths{name="${path}",state="ready"} `
  const bytesPrefix = `paths_inbound_bytes{name="${path}",state="ready"} `
  let ready = false
  let inboundBytes: number | null = null
  for (const line of metrics.split('\n')) {
    if (line.startsWith(statePrefix)) ready = Number(line.slice(statePrefix.length)) === 1
    if (line.startsWith(bytesPrefix)) {
      const value = Number(line.slice(bytesPrefix.length))
      if (Number.isFinite(value) && value >= 0) inboundBytes = value
    }
  }
  return { ready, inboundBytes }
}

/** Endpoint de métricas configurado pelo operador do servidor; só loopback nesta etapa. */
export async function probeMediaSource(sessionId: string): Promise<SourceProbe> {
  const path = `session-${sessionId}`
  const checkedAt = new Date().toISOString()
  const configuredUrl = process.env.MEDIA_METRICS_URL?.trim()
  if (!configuredUrl) return { configured: false, ready: false, path, checkedAt, inboundBytes: null, error: null }
  try {
    const url = new URL(configuredUrl)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      return { configured: false, ready: false, path, checkedAt, inboundBytes: null, error: 'Endereço de métricas inválido.' }
    }
    url.pathname = '/metrics'
    url.search = ''
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(1500) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const signal = parseMediaMetrics(await response.text(), path)
    return { configured: true, path, checkedAt, ...signal, error: null }
  } catch {
    return { configured: true, ready: false, path, checkedAt, inboundBytes: null, error: 'Serviço de mídia indisponível.' }
  }
}
