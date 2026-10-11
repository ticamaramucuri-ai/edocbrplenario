import { describe, expect, test } from 'bun:test'
import { issueRealtimeGrant, verifyRealtimeGrant } from '../src/lib/realtime-auth'

const secret = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres'
const tenantId = 'c12345678901234567890'
const now = Date.UTC(2026, 9, 10, 12)

describe('autorização de sala interna', () => {
  test('aceita apenas o token assinado dentro da validade', () => {
    const token = issueRealtimeGrant(tenantId, 'ator-1', secret, now)
    expect(verifyRealtimeGrant(token, secret, now)?.tenantId).toBe(tenantId)
    expect(verifyRealtimeGrant(token, secret, now + 120_000)).toBeNull()
  })

  test('rejeita alteração, segredo incorreto e token malformado', () => {
    const token = issueRealtimeGrant(tenantId, 'ator-1', secret, now)
    const [body, signature] = token.split('.')
    const tampered = `${Buffer.from(JSON.stringify({ v: 1, tenantId: 'c99999999999999999999', actorId: 'ator-1', exp: now / 1000 + 120, nonce: '123456789012' })).toString('base64url')}.${signature}`
    expect(verifyRealtimeGrant(tampered, secret, now)).toBeNull()
    expect(verifyRealtimeGrant(`${body}.${signature}`, secret + 'x', now)).toBeNull()
    expect(verifyRealtimeGrant('invalid', secret, now)).toBeNull()
  })
})
