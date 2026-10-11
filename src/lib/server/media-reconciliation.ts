/** Reconciliador durável: o banco guarda intenção; MediaMTX é estado observado. */
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { DomainError } from './errors'
import { probeMediaSource } from './media-status'
import { setDestinationEnabled } from './media-control'
import { withTransaction } from './tx'
import { writeAudit } from './audit'
import { notify } from './notify'
import { withMediaPathLease } from './media-path-lease'

async function notifyMediaOperators(tx: Parameters<typeof notify>[0], tenantId: string, title: string, body: string): Promise<void> {
  for (const targetRole of ['media_operator', 'tenant_admin']) {
    await notify(tx, { tenantId, title, body, kind: 'system', module: 'plenary', targetRole })
  }
}

const LEASE_MS = 30_000
const VERIFY_MS = 10_000

export async function reconcileMediaIntentsOnce(limit = 20): Promise<{ claimed: number; applied: number; failed: number }> {
  const now = new Date()
  const candidates = await db.mediaDestinationIntent.findMany({
    where: {
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }],
    },
    include: { transmission: { select: { tenantId: true, sessionId: true, status: true } } },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 100)),
  })
  let claimed = 0
  let applied = 0
  let failed = 0
  for (const intent of candidates) {
    const owner = randomUUID()
    const lease = await db.mediaDestinationIntent.updateMany({
      where: {
        id: intent.id,
        generation: intent.generation,
        AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }],
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS) },
    })
    if (!lease.count) continue
    claimed++
    const { tenantId, sessionId, status } = intent.transmission
    try {
      if (intent.desiredEnabled) {
        if (status !== 'monitoring') {
          // Mesmo que uma alteração externa tenha encerrado o acompanhamento,
          // nunca deixe um encaminhamento antigo ativo.
          await withMediaPathLease(`session-${sessionId}`, () => setDestinationEnabled(tenantId, `session-${sessionId}`, intent.destinationId, false))
          throw new DomainError('MEDIA_INVALID_TRANSITION', 409, 'Acompanhamento encerrado', 'O destino não pode ser ativado fora do acompanhamento.')
        }
        if (!(await probeMediaSource(sessionId)).ready) {
          throw new DomainError('MEDIA_SOURCE_UNAVAILABLE', 409, 'Sinal indisponível', 'A fonte local não está pronta.')
        }
      }
      const changed = await withMediaPathLease(`session-${sessionId}`, () => setDestinationEnabled(tenantId, `session-${sessionId}`, intent.destinationId, intent.desiredEnabled))
      const shouldAudit = changed || intent.syncStatus !== 'applied' || intent.observedGeneration !== intent.generation
      await withTransaction(async (tx) => {
        const updated = await tx.mediaDestinationIntent.updateMany({
          where: { id: intent.id, generation: intent.generation, leaseOwner: owner },
          data: {
            observedGeneration: intent.generation,
            syncStatus: 'applied',
            attempts: 0,
            lastErrorCode: null,
            nextAttemptAt: new Date(Date.now() + VERIFY_MS),
            leaseOwner: null,
            leaseUntil: null,
            lastAppliedAt: new Date(),
          },
        })
        if (updated.count && shouldAudit) {
          await writeAudit(tx, {
            tenantId,
            actor: { name: 'Controlador de mídia', role: 'media_operator' },
            action: 'transmission.destination_reconciled',
            aggregateType: 'transmission',
            aggregateId: intent.transmissionId,
            summary: `Destino ${intent.destinationId}: estado ${intent.desiredEnabled ? 'ativo' : 'inativo'} confirmado no MediaMTX.`,
            after: { destinationId: intent.destinationId, enabled: intent.desiredEnabled, generation: intent.generation },
            correlationId: owner,
          })
          if (intent.syncStatus === 'error') {
            await notifyMediaOperators(tx, tenantId, 'Destino de mídia normalizado', `O destino ${intent.destinationId} da sessão ${sessionId} voltou ao estado solicitado.`)
          }
        }
      })
      applied++
    } catch (error) {
      const code = error instanceof DomainError ? error.code : 'MEDIA_CONTROL_UNAVAILABLE'
      const attempts = intent.attempts + 1
      const delayMs = Math.min(60_000, 2_000 * 2 ** Math.min(attempts - 1, 5))
      await withTransaction(async (tx) => {
        const updated = await tx.mediaDestinationIntent.updateMany({
          where: { id: intent.id, generation: intent.generation, leaseOwner: owner },
          data: {
            syncStatus: 'error',
            attempts,
            lastErrorCode: code,
            nextAttemptAt: new Date(Date.now() + delayMs),
            leaseOwner: null,
            leaseUntil: null,
          },
        })
        if (updated.count && (intent.syncStatus !== 'error' || intent.lastErrorCode !== code)) {
          await writeAudit(tx, {
            tenantId,
            actor: { name: 'Controlador de mídia', role: 'media_operator' },
            action: 'transmission.destination_reconcile_failed',
            aggregateType: 'transmission',
            aggregateId: intent.transmissionId,
            summary: `Destino ${intent.destinationId}: aplicação pendente (${code}).`,
            after: { destinationId: intent.destinationId, generation: intent.generation, errorCode: code },
            correlationId: owner,
          })
          await notifyMediaOperators(tx, tenantId, 'Falha no destino de mídia', `O destino ${intent.destinationId} da sessão ${sessionId} precisa de atenção (${code}).`)
        }
      })
      failed++
    }
  }
  return { claimed, applied, failed }
}
