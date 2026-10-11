import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { DomainError } from './errors'

const LEASE_MS = 30_000
const WAIT_MS = 10_000

/** Serializa o ciclo ler/PATCH/verificar da Control API entre processos. */
export async function withMediaPathLease<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const owner = randomUUID()
  const deadline = Date.now() + WAIT_MS
  await db.mediaPathLease.upsert({
    where: { path },
    create: { path, owner: '', leaseUntil: new Date(0) },
    update: {},
  })
  let acquired = false
  do {
    const now = new Date()
    const claim = await db.mediaPathLease.updateMany({
      where: { path, leaseUntil: { lte: now } },
      data: { owner, leaseUntil: new Date(now.getTime() + LEASE_MS) },
    })
    if (claim.count) { acquired = true; break }
    if (Date.now() >= deadline) break
    await Bun.sleep(50 + Math.floor(Math.random() * 50))
  } while (true)
  if (!acquired) {
    throw new DomainError('MEDIA_PATH_BUSY', 503, 'Caminho ocupado', 'Outro operador está alterando os destinos desta sessão.')
  }
  try {
    return await operation()
  } finally {
    await db.mediaPathLease.updateMany({
      where: { path, owner },
      data: { owner: '', leaseUntil: new Date(0) },
    })
  }
}
