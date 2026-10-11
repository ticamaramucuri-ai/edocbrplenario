import { createHmac } from 'crypto'
import type { DeliveryOutcome } from './postgres-delivery'

const HTTP_TIMEOUT_MS = 10_000

export async function deliverWebhook(
  url: string,
  secret: string,
  eventType: string,
  payload: string,
  deliveryId: string,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<DeliveryOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-legis-signature': `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`,
        'x-legis-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-legis-event': eventType,
        'x-legis-delivery-id': deliveryId,
      },
      body: payload,
      signal: controller.signal,
    })
    await res.text().catch(() => '')
    if (res.ok) return { kind: 'success', responseStatus: res.status }
    return { kind: 'failure', responseStatus: res.status, error: `HTTP ${res.status} ${res.statusText}`.trim() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'failure', responseStatus: null, error: message }
  } finally {
    clearTimeout(timer)
  }
}
