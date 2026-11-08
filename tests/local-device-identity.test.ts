import { afterAll, expect, test } from 'bun:test'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession } from '@/lib/server/session'
import { localDeviceRequestMessage, authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'
import { GET as listDevices, POST as registerDevice } from '@/app/api/v1/local-devices/route'
import { POST as designateDevice } from '@/app/api/v1/local-devices/[id]/designate/route'
import { POST as revokeDevice } from '@/app/api/v1/local-devices/[id]/revoke/route'

afterAll(async () => { await db.$disconnect() })

test('registro, designação e revogação exigem admin nominal com MFA e isolam Câmaras', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `device-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `device-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin A', email: `device-a-${suffix}@example.invalid`, role: 'tenant_admin', mfaEnabled: true } })
  const adminB = await db.user.create({ data: { tenantId: other.id, name: 'Admin B', email: `device-b-${suffix}@example.invalid`, role: 'tenant_admin', mfaEnabled: true } })
  const unverified = await createSession(admin.id)
  const token = await createSession(admin.id, null, null, true)
  const tokenB = await createSession(adminB.id, null, null, true)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const baseUrl = 'http://localhost/api/v1/local-devices'
  const context = { params: Promise.resolve({}) }
  const body = { name: 'Servidor do plenário', publicKeyPem: pem, approvalReference: 'Autorização de ensaio 01' }
  const post = (cookie: string, data = body, adminHeader = '1') => registerDevice(new NextRequest(baseUrl, { method: 'POST',
    headers: { cookie: `legis_session=${cookie}`, 'content-type': 'application/json', 'x-edocbr-admin-action': adminHeader },
    body: JSON.stringify(data) }), context)
  expect((await post(unverified)).status).toBe(401)
  expect((await post(token, body, '')).status).toBe(403)
  const created = await post(token)
  expect(created.status).toBe(201)
  const deviceId = (await created.json()).device.id as string
  expect((await post(token)).status).toBe(409)
  expect((await post(tokenB)).status).toBe(409)
  const list = await (await listDevices(new NextRequest(baseUrl, { headers: { cookie: `legis_session=${token}` } }), context)).json()
  expect(list.devices).toHaveLength(1)
  expect(list.devices[0].publicKeyPem).toBeUndefined()
  const otherList = await (await listDevices(new NextRequest(baseUrl, { headers: { cookie: `legis_session=${tokenB}` } }), context)).json()
  expect(otherList.devices).toHaveLength(0)
  const designationUrl = `${baseUrl}/${deviceId}/designate`
  const designate = (cookie: string, generation: number) => designateDevice(new NextRequest(designationUrl, { method: 'POST',
    headers: { cookie: `legis_session=${cookie}`, 'content-type': 'application/json', 'x-edocbr-admin-action': '1' },
    body: JSON.stringify({ expectedGeneration: generation, approvalReference: 'Ato administrativo 02' }) }),
  { params: Promise.resolve({ id: deviceId }) })
  expect((await designate(tokenB, 0)).status).toBe(404)
  expect((await designate(token, 0)).status).toBe(200)
  expect((await designate(token, 0)).status).toBe(409)
  const nonce = randomBytes(24).toString('base64url')
  const timestamp = String(Date.now())
  const transferUrl = 'https://example.invalid/api/v1/sessions/session-1/transfer?revision=1'
  const message = localDeviceRequestMessage({ tenantId: tenant.id, deviceId, method: 'GET',
    pathAndQuery: '/api/v1/sessions/session-1/transfer?revision=1', timestamp, nonce })
  const signature = sign(null, message, privateKey).toString('base64')
  const authenticated = new NextRequest(transferUrl, { headers: {
    'x-edocbr-device-id': deviceId, 'x-edocbr-device-timestamp': timestamp,
    'x-edocbr-device-nonce': nonce, 'x-edocbr-device-signature': signature,
  } })
  expect((await authenticateLocalDeviceRequest(authenticated, tenant.id)).id).toBe(deviceId)
  await expect(authenticateLocalDeviceRequest(authenticated, tenant.id)).rejects.toMatchObject({ code: 'LOCAL_DEVICE_REPLAY' })
  await expect(authenticateLocalDeviceRequest(authenticated, other.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  const tampered = new NextRequest(transferUrl.replace('revision=1', 'revision=2'), { headers: authenticated.headers })
  await expect(authenticateLocalDeviceRequest(tampered, tenant.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  const revokeUrl = `${baseUrl}/${deviceId}/revoke`
  const revoke = (cookie: string) => revokeDevice(new NextRequest(revokeUrl, { method: 'POST',
    headers: { cookie: `legis_session=${cookie}`, 'content-type': 'application/json', 'x-edocbr-admin-action': '1' },
    body: JSON.stringify({ reason: 'Equipamento substituído em ensaio' }) }),
  { params: Promise.resolve({ id: deviceId }) })
  expect((await revoke(tokenB)).status).toBe(404)
  expect((await revoke(token)).status).toBe(200)
  const designation = await db.localServerDesignation.findUniqueOrThrow({ where: { tenantId: tenant.id } })
  expect(designation.deviceId).toBeNull()
  expect(designation.generation).toBe(2)
  const freshNonce = randomBytes(24).toString('base64url')
  const freshMessage = localDeviceRequestMessage({ tenantId: tenant.id, deviceId, method: 'GET',
    pathAndQuery: '/api/v1/sessions/session-1/transfer?revision=1', timestamp, nonce: freshNonce })
  const afterRevoke = new NextRequest(transferUrl, { headers: {
    'x-edocbr-device-id': deviceId, 'x-edocbr-device-timestamp': timestamp,
    'x-edocbr-device-nonce': freshNonce, 'x-edocbr-device-signature': sign(null, freshMessage, privateKey).toString('base64'),
  } })
  await expect(authenticateLocalDeviceRequest(afterRevoke, tenant.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  expect(await db.auditEvent.count({ where: { tenantId: tenant.id, action: { in: [
    'local_device.registered', 'local_device.designated', 'local_device.revoked' ] } } })).toBe(3)
})
