/**
 * Outbox transacional (ADR-003): toda mutação de domínio grava o evento NA
 * MESMA TRANSAÇÃO; o mini-serviço realtime (porta 3003) faz polling e publica.
 *
 * Contrato de payload para o serviço (agente 2-b):
 * - `internalPayload` / `publicPayload` são JSON stringificados;
 * - ambos SEMPRE incluem `origin` ('operator' | 'cloud'), `aggregateVersion`
 *   (número) e `correlationId` (uuid da requisição) no nível raiz, junto dos
 *   campos específicos do evento (docs/api-contract.md §Eventos outbox);
 * - envelope montado pelo serviço: eventId = row.id, eventType = row.eventType,
 *   tenantId/sessionId/aggregateId = colunas, occurredAt = createdAt ISO,
 *   schemaVersion = 1.
 */
import type { Prisma } from '@prisma/client'
import type { RealtimeEventType } from '@/lib/contracts'
import { enqueueMatchingWebhooks } from './webhooks'

type Tx = Prisma.TransactionClient

export type EmitOutboxInput = {
  tenantId: string
  eventType: RealtimeEventType
  aggregateId: string
  sessionId?: string | null
  aggregateVersion: number
  correlationId: string
  /** Origem do evento — alinhado ao envelope RealtimeEvent (contracts.ts). */
  origin?: 'operator' | 'cloud' | 'pwa' | 'integration'
  internalPayload: Record<string, unknown>
  /** Null/undefined = evento não público (não vai para portal/telão). */
  publicPayload?: Record<string, unknown> | null
}

export async function emitOutbox(tx: Tx, input: EmitOutboxInput): Promise<void> {
  const origin = input.origin ?? 'operator'
  const meta = {
    origin,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
  }
  await tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      eventType: input.eventType,
      aggregateId: input.aggregateId,
      sessionId: input.sessionId ?? null,
      internalPayload: JSON.stringify({ ...input.internalPayload, ...meta }),
      publicPayload: input.publicPayload
        ? JSON.stringify({ ...input.publicPayload, ...meta })
        : null,
      status: 'pending',
    },
  })
  // Fase 6 — ponto único de gatilho de webhooks: todo evento público da
  // allowlist de disparo enfileira entregas para endpoints inscritos.
  if (input.publicPayload) {
    await enqueueMatchingWebhooks(tx, input.tenantId, input.eventType, input.publicPayload)
  }
}
