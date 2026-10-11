/**
 * Notificações internas (Fase 6) — criação transacional de Notification +
 * evento outbox `notification.new` (escopo INTERNO apenas: notificações nunca
 * vão para o portal/telão públicos).
 *
 * Leitura é individual por papel (demo ADR-005): targetRole null = todos os
 * papéis do tenant; caso contrário apenas atores com aquele papel enxergam.
 */
import type { Notification, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { emitOutbox } from './outbox'

type Tx = Prisma.TransactionClient

export type NotifyInput = {
  tenantId: string
  title: string
  body: string
  kind: 'session' | 'voting' | 'task' | 'webhook' | 'system'
  module?: string | null
  /** Papel destinatário (Role) ou null para todos. */
  targetRole?: string | null
  dedupeKey?: string | null
}

/** Cria a Notification e emite `notification.new` (interno) na mesma tx. */
export async function notify(tx: Tx, input: NotifyInput): Promise<Notification> {
  const created = await tx.notification.create({
    data: {
      tenantId: input.tenantId,
      title: input.title,
      body: input.body,
      kind: input.kind,
      module: input.module ?? null,
      targetRole: input.targetRole ?? null,
      dedupeKey: input.dedupeKey ?? null,
    },
  })
  await emitOutbox(tx, {
    tenantId: input.tenantId,
    eventType: 'notification.new',
    aggregateId: created.id,
    aggregateVersion: 1,
    correlationId: randomUUID(),
    origin: 'cloud',
    // Interno apenas (publicPayload null → não vai para a sala pública e
    // não dispara webhooks).
    internalPayload: {
      notificationId: created.id,
      title: created.title,
      body: created.body,
      kind: created.kind,
      module: created.module,
      targetRole: created.targetRole,
      createdAt: created.createdAt.toISOString(),
    },
  })
  return created
}
