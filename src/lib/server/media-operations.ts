import { db } from '@/lib/db'

const WORKER_ID = 'destination-reconciler'
export const MEDIA_HEARTBEAT_MAX_AGE_MS = 30_000
export const MEDIA_PENDING_MAX_AGE_MS = 60_000

export async function beatMediaWorker(owner: string, cycleComplete = false): Promise<void> {
  const now = new Date()
  await db.mediaWorkerHeartbeat.upsert({
    where: { id: WORKER_ID },
    create: { id: WORKER_ID, owner, lastBeatAt: now, lastCycleAt: cycleComplete ? now : null },
    update: { owner, lastBeatAt: now, ...(cycleComplete ? { lastCycleAt: now } : {}) },
  })
}

export type MediaOperationsHealth = {
  ok: boolean
  checkedAt: string
  worker: 'alive' | 'stale' | 'missing'
  lastBeatAt: string | null
  lastCycleAt: string | null
  pendingStale: number
  failedDestinations: number
  reasons: string[]
}

/** Estado global para um monitor local; não inclui tenants, URLs nem chaves. */
export async function readMediaOperationsHealth(now = new Date()): Promise<MediaOperationsHealth> {
  const [heartbeat, pendingStale, failedDestinations] = await Promise.all([
    db.mediaWorkerHeartbeat.findUnique({ where: { id: WORKER_ID } }),
    db.mediaDestinationIntent.count({ where: { syncStatus: 'pending', updatedAt: { lt: new Date(now.getTime() - MEDIA_PENDING_MAX_AGE_MS) } } }),
    db.mediaDestinationIntent.count({ where: { syncStatus: 'error' } }),
  ])
  const worker = !heartbeat ? 'missing'
    : now.getTime() - heartbeat.lastBeatAt.getTime() > MEDIA_HEARTBEAT_MAX_AGE_MS ? 'stale' : 'alive'
  const reasons: string[] = []
  if (worker !== 'alive') reasons.push(`worker_${worker}`)
  if (pendingStale) reasons.push('destination_pending_stale')
  if (failedDestinations) reasons.push('destination_reconcile_error')
  return {
    ok: reasons.length === 0,
    checkedAt: now.toISOString(),
    worker,
    lastBeatAt: heartbeat?.lastBeatAt.toISOString() ?? null,
    lastCycleAt: heartbeat?.lastCycleAt?.toISOString() ?? null,
    pendingStale,
    failedDestinations,
    reasons,
  }
}
