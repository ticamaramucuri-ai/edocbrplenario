/**
 * Auditoria append-only com cadeia de hash (ADR-004).
 * chainHash = sha256(prevHash + '|' + JSON.stringify(canônico)) — formato
 * compatível com a cadeia sembrada em prisma/seed.ts (verificação O(n)/tenant).
 */
import { createHash } from 'crypto'
import type { AuditEvent, Prisma } from '@prisma/client'
import type { ResolvedActor } from './actor'

type Tx = Prisma.TransactionClient

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export type AuditInput = {
  tenantId: string
  actor: Pick<ResolvedActor, 'name' | 'role'>
  action: string
  aggregateType: string
  aggregateId?: string | null
  summary: string
  before?: unknown
  after?: unknown
  justification?: string | null
  correlationId: string
  ip?: string | null
}

/**
 * Corpo canônico usado no hash — A ORDEM DAS CHAVES É PARTE DO CONTRATO
 * (idêntica ao seed). Não alterar sem quebrar a cadeia existente.
 */
export function canonicalAuditBody(row: {
  tenantId: string
  actorName: string
  actorRole: string
  action: string
  aggregateType: string
  aggregateId: string | null
  summary: string
  beforeValue: string | null
  afterValue: string | null
  justification: string | null
  createdAt: Date
}): Record<string, unknown> {
  return {
    tenantId: row.tenantId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId ?? null,
    summary: row.summary,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    justification: row.justification ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function computeChainHash(prevHash: string | null, body: Record<string, unknown>): string {
  return sha256(`${prevHash ?? ''}|${JSON.stringify(body)}`)
}

/**
 * Grava AuditEvent encadeado ao último evento do tenant. `createdAt` gerado
 * aqui (com guarda monotônica por ms) para que hash e linha armazenada batam.
 */
export async function writeAudit(tx: Tx, input: AuditInput): Promise<AuditEvent> {
  const last = await tx.auditEvent.findFirst({
    where: { tenantId: input.tenantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { chainHash: true, createdAt: true },
  })
  const prevHash = last?.chainHash ?? null
  let createdAt = new Date()
  if (last && createdAt.getTime() <= last.createdAt.getTime()) {
    createdAt = new Date(last.createdAt.getTime() + 1)
  }
  const beforeValue = input.before === undefined ? null : JSON.stringify(input.before)
  const afterValue = input.after === undefined ? null : JSON.stringify(input.after)
  const body = canonicalAuditBody({
    tenantId: input.tenantId,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    action: input.action,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId ?? null,
    summary: input.summary,
    beforeValue,
    afterValue,
    justification: input.justification ?? null,
    createdAt,
  })
  const chainHash = computeChainHash(prevHash, body)
  return tx.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorId: null,
      actorName: input.actor.name,
      actorRole: input.actor.role,
      action: input.action,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId ?? null,
      summary: input.summary,
      beforeValue,
      afterValue,
      justification: input.justification ?? null,
      correlationId: input.correlationId,
      ip: input.ip ?? null,
      prevHash,
      chainHash,
      createdAt,
    },
  })
}

/** Recalcula a cadeia inteira do tenant (ordem createdAt asc) e devolve o head. */
export function verifyChain(
  eventsAsc: AuditEvent[]
): { valid: boolean; head: string | null; brokenAt: string | null } {
  let prev: string | null = null
  for (const ev of eventsAsc) {
    const expected = computeChainHash(prev, canonicalAuditBody(ev))
    if (ev.prevHash !== prev || ev.chainHash !== expected) {
      return { valid: false, head: prev, brokenAt: ev.id }
    }
    prev = ev.chainHash
  }
  return { valid: true, head: prev, brokenAt: null }
}
