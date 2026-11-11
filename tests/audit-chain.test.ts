import { expect, test } from 'bun:test'
import type { AuditEvent } from '@prisma/client'
import { canonicalAuditBody, computeChainHash, verifyChain } from '@/lib/server/audit'

function makeEvent(id: string, createdAt: Date, prevHash: string | null, summary = id): AuditEvent {
  const event = {
    id,
    tenantId: 'tenant-audit-test',
    actorId: null,
    actorName: 'Operador local',
    actorRole: 'tenant_admin',
    action: 'test.event',
    aggregateType: 'test',
    aggregateId: id,
    summary,
    beforeValue: null,
    afterValue: null,
    justification: null,
    correlationId: `correlation-${id}`,
    ip: null,
    prevHash,
    chainHash: '',
    createdAt,
  }
  event.chainHash = computeChainHash(prevHash, canonicalAuditBody(event))
  return event
}

test('verifica a cadeia por prevHash mesmo quando os timestamps históricos não estão em ordem', () => {
  const first = makeEvent('first', new Date('2026-11-10T12:00:00.000Z'), null)
  const second = makeEvent('second', new Date('2026-11-09T12:00:00.000Z'), first.chainHash)
  const third = makeEvent('third', new Date('2026-11-11T12:00:00.000Z'), second.chainHash)

  expect(verifyChain([second, first, third])).toEqual({ valid: true, head: third.chainHash, brokenAt: null })
})

test('detecta evento adulterado, raiz ausente e bifurcação da cadeia', () => {
  const first = makeEvent('root', new Date('2026-11-10T12:00:00.000Z'), null)
  const second = makeEvent('child', new Date('2026-11-10T12:00:01.000Z'), first.chainHash)
  const tampered = { ...second, summary: 'conteúdo alterado' }
  const branch = makeEvent('branch', new Date('2026-11-10T12:00:02.000Z'), first.chainHash)

  expect(verifyChain([first, tampered]).brokenAt).toBe(second.id)
  expect(verifyChain([second]).valid).toBe(false)
  expect(verifyChain([first, second, branch]).valid).toBe(false)
})

test('cadeia sem eventos tem head vazio e é válida', () => {
  expect(verifyChain([])).toEqual({ valid: true, head: null, brokenAt: null })
})
