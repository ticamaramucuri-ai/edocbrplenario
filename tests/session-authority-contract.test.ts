import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { signSessionAuthorityGrant, verifySessionAuthorityGrant,
  type SessionAuthorityGrant } from '@/lib/session-authority-contract'

const key = generateKeyPairSync('ed25519')
const otherKey = generateKeyPairSync('ed25519')
const now = new Date('2026-11-09T12:00:00.000Z')
const grant: SessionAuthorityGrant = {
  format: 'edocbr.session-authority', schemaVersion: 1,
  tenantId: 'camara-a', sessionId: 'sessao-1', deviceId: 'desktop-1',
  revisionId: 'revisao-3', manifestSha256: 'a'.repeat(64), epoch: 7,
  issuedAt: '2026-11-09T11:59:00.000Z', notBefore: '2026-11-09T12:00:00.000Z',
  expiresAt: '2026-11-09T12:10:00.000Z',
}
const options = {
  tenantId: grant.tenantId, sessionId: grant.sessionId, deviceId: grant.deviceId,
  revisionId: grant.revisionId, manifestSha256: grant.manifestSha256,
  trustedKeys: new Map([['tenant-key-1', key.publicKey]]), now,
}

test('concessão assinada vincula dispositivo, revisão, hash e época', () => {
  const signed = signSessionAuthorityGrant(grant, 'tenant-key-1', key.privateKey)
  expect(verifySessionAuthorityGrant(signed, { ...options, minimumEpoch: 7 })).toEqual(grant)
  expect(() => verifySessionAuthorityGrant(signed, { ...options, deviceId: 'desktop-2' })).toThrow()
  expect(() => verifySessionAuthorityGrant(signed, { ...options, manifestSha256: 'b'.repeat(64) })).toThrow()
  expect(() => verifySessionAuthorityGrant(signed, { ...options, minimumEpoch: 8 })).toThrow()
  expect(() => verifySessionAuthorityGrant(signed, { ...options, now: new Date(grant.expiresAt) })).toThrow()
  expect(() => verifySessionAuthorityGrant(signed, { ...options, now: new Date('2026-11-09T11:59:59Z') })).toThrow()
})

test('recusa adulteração, chave alheia e concessão excessivamente longa', () => {
  const signed = signSessionAuthorityGrant(grant, 'tenant-key-1', key.privateKey)
  expect(() => verifySessionAuthorityGrant({ ...signed, grant: { ...grant, epoch: 8 } }, options)).toThrow()
  expect(() => verifySessionAuthorityGrant(signed, { ...options,
    trustedKeys: new Map([['tenant-key-1', otherKey.publicKey]]) })).toThrow()
  expect(() => signSessionAuthorityGrant({ ...grant,
    expiresAt: '2026-11-09T12:20:00.000Z' }, 'tenant-key-1', key.privateKey)).toThrow()
})
