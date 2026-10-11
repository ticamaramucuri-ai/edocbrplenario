/**
 * Webhooks (Fase 6) — allowlist de eventos, serialização e enfileiramento de
 * entregas `WebhookDelivery` NA MESMA TRANSAÇÃO do evento de negócio.
 *
 * Ponto central de gatilho: `src/lib/server/outbox.ts` chama
 * `enqueueMatchingWebhooks` sempre que um evento PÚBLICO da allowlist de
 * disparo é emitido (session.state_changed, voting.result, matter.proceeding,
 * matter.status_changed). O evento `notification.new` NÃO dispara webhook
 * (escopo interno).
 *
 * A entrega em si (HTTP + assinatura HMAC + retentativas) é feita pelo
 * mini-serviço `mini-services/webhooks` (porta 3004), que faz polling das
 * entregas `pending`.
 */
import { randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/lib/contracts'

type Tx = Prisma.TransactionClient

/** Eventos que disparam enfileiramento de webhook quando emitidos publicamente. */
export const WEBHOOK_TRIGGER_EVENTS: readonly string[] = [
  'session.state_changed',
  'voting.result',
  'matter.proceeding',
  'matter.status_changed',
  // Fases 10–11 — faturamento e publicações/participação
  'billing.invoice_created',
  'billing.invoice_paid',
  'billing.invoice_overdue',
  'publication.published',
  'publication.revoked',
  'hearing.state_changed',
]

export const isAllowedWebhookEvent = (t: string): t is WebhookEventType =>
  (WEBHOOK_EVENT_TYPES as readonly string[]).includes(t)

/** Gera segredo HMAC por endpoint (64 hex = 256 bits). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

/** Mascara o segredo p/ exibição: primeiros 6 + … + últimos 4 caracteres. */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return `${secret.slice(0, 2)}…`
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`
}

/** Valida URL http(s) alcançável para integração. */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && url.length <= 2000
  } catch {
    return false
  }
}

export function parseWebhookEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Enfileira entregas para TODOS os endpoints ativos do tenant inscritos no
 * eventType (mesma transação do fluxo de negócio — entrega at-least-once).
 */
export async function enqueueMatchingWebhooks(
  tx: Tx,
  tenantId: string,
  eventType: string,
  publicPayload: Record<string, unknown>
): Promise<number> {
  if (!WEBHOOK_TRIGGER_EVENTS.includes(eventType)) return 0
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { tenantId, active: true },
    select: { id: true, events: true },
  })
  const matching = endpoints.filter((e) => parseWebhookEvents(e.events).includes(eventType))
  if (matching.length === 0) return 0
  const payload = JSON.stringify({
    event: eventType,
    tenantId,
    data: publicPayload,
    sentAt: new Date().toISOString(),
  })
  await tx.webhookDelivery.createMany({
    data: matching.map((e) => ({
      endpointId: e.id,
      eventType,
      payload,
      status: 'pending',
    })),
  })
  return matching.length
}
