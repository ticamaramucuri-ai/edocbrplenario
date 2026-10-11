/**
 * Transação Prisma compartilhada com fila de escrita in-process.
 *
 * Motivo (ADR-003/correção de contenção): SQLite permite UM único escritor.
 * Transações interativas concorrentes do Prisma (ex.: 13 check-ins paralelos
 * do plenário) colidem no BEGIN IMMEDIATE e estouram o timeout do driver
 * (P1008 "Socket timeout"). Este mutex serializa as transações de escrita no
 * próprio processo — cada uma leva ~100ms, então lotes de 13 completam em ~1,5s.
 * Leitura permanece concorrente (WAL).
 */
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

let writeChain: Promise<unknown> = Promise.resolve()

export function withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const run = writeChain.then(() =>
    db.$transaction(fn, { timeout: 30_000, maxWait: 15_000 })
  )
  // Mantém a cadeia viva mesmo quando uma transação falha.
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
