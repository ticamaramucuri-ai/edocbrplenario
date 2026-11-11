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
  actor: Pick<ResolvedActor, 'name'> & { role: string }
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

/** Verifica a cadeia pelos elos prevHash, sem depender da ordenação dos timestamps. */
export function verifyChain(
  events: AuditEvent[]
): { valid: boolean; head: string | null; brokenAt: string | null } {
  if (events.length === 0) return { valid: true, head: null, brokenAt: null }

  const childrenByPrevHash = new Map<string | null, AuditEvent[]>()
  for (const event of events) {
    const siblings = childrenByPrevHash.get(event.prevHash) ?? []
    siblings.push(event)
    childrenByPrevHash.set(event.prevHash, siblings)
  }

  const roots = childrenByPrevHash.get(null) ?? []
  if (roots.length !== 1) {
    return { valid: false, head: null, brokenAt: roots[1]?.id ?? events[0].id }
  }

  let current: AuditEvent | undefined = roots[0]
  let previousHash: string | null = null
  let head: string | null = null
  const visited = new Set<string>()

  while (current) {
    if (visited.has(current.id)) return { valid: false, head, brokenAt: current.id }
    const expected = computeChainHash(previousHash, canonicalAuditBody(current))
    if (current.prevHash !== previousHash || current.chainHash !== expected) {
      return { valid: false, head, brokenAt: current.id }
    }
    visited.add(current.id)
    previousHash = current.chainHash
    head = current.chainHash

    const children = childrenByPrevHash.get(current.chainHash) ?? []
    if (children.length > 1) return { valid: false, head, brokenAt: children[1].id }
    current = children[0]
  }

  if (visited.size !== events.length) {
    const orphan = events.find((event) => !visited.has(event.id))
    return { valid: false, head, brokenAt: orphan?.id ?? null }
  }
  return { valid: true, head, brokenAt: null }
}
