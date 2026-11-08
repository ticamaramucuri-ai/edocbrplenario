import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enrollLocalDevice, initializeLocalDevice, loadLocalDevice, trustLocalTransferKey } from '@/lib/local-device-keystore'

const passphrase = 'frase de ensaio longa e exclusiva 2026'

test('bootstrap cifra chave privada, vincula um dispositivo e confia por impressão externa', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'edocbr-local-identity-'))
  const root = join(parent, 'desktop')
  try {
    const bootstrap = await initializeLocalDevice({ root, tenantId: 'camara-a',
      baseUrl: 'https://example.invalid', passphrase })
    expect(bootstrap.config.deviceId).toBeNull()
    expect(bootstrap.publicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(await readFile(join(root, 'identity.enc.json'), 'utf8')).not.toContain('BEGIN PRIVATE KEY')
    await expect(initializeLocalDevice({ root, tenantId: 'camara-b',
      baseUrl: 'https://example.invalid', passphrase })).rejects.toThrow()
    await expect(loadLocalDevice({ root, passphrase })).rejects.toThrow('vinculado')
    expect((await enrollLocalDevice(root, 'device-1')).deviceId).toBe('device-1')
    expect((await enrollLocalDevice(root, 'device-1')).deviceId).toBe('device-1')
    await expect(enrollLocalDevice(root, 'device-2')).rejects.toThrow('outro ID')
    const signing = generateKeyPairSync('ed25519')
    const publicKeyPem = signing.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const expectedSpkiSha256 = createHash('sha256')
      .update(signing.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).digest('hex')
    await expect(trustLocalTransferKey({ root, keyId: 'k-1', publicKeyPem,
      expectedSpkiSha256: '0'.repeat(64) })).rejects.toThrow('diverge')
    expect(await trustLocalTransferKey({ root, keyId: 'k-1', publicKeyPem,
      expectedSpkiSha256 })).toBe(expectedSpkiSha256)
    expect(await trustLocalTransferKey({ root, keyId: 'k-1', publicKeyPem,
      expectedSpkiSha256 })).toBe(expectedSpkiSha256)
    await expect(loadLocalDevice({ root, passphrase: 'frase errada mas longa e válida' })).rejects.toThrow('inválida')
    const loaded = await loadLocalDevice({ root, passphrase })
    expect(loaded.config.tenantId).toBe('camara-a')
    expect(loaded.config.deviceId).toBe('device-1')
    expect([...loaded.trustedKeys.keys()]).toEqual(['k-1'])
    const message = Buffer.from('pedido local')
    expect(verify(null, message, bootstrap.publicKeyPem, sign(null, message, loaded.privateKey))).toBe(true)
    await writeFile(join(root, 'device.json'), JSON.stringify({ ...loaded.config, tenantId: 'camara-b' }), { mode: 0o600 })
    await expect(loadLocalDevice({ root, passphrase })).rejects.toThrow('inválida')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('arquivo privado aberto ou symlink impede carregar identidade', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'edocbr-local-identity-'))
  const root = join(parent, 'desktop')
  try {
    await initializeLocalDevice({ root, tenantId: 'camara-a', baseUrl: 'https://example.invalid', passphrase })
    const configPath = join(root, 'device.json')
    if (process.platform !== 'win32') {
      await chmod(configPath, 0o644)
      await expect(enrollLocalDevice(root, 'device-1')).rejects.toThrow('inseguro')
      await chmod(configPath, 0o600)
    }
    const backup = join(parent, 'copy.json')
    await writeFile(backup, await readFile(configPath))
    await rm(configPath)
    await symlink(backup, configPath)
    await expect(enrollLocalDevice(root, 'device-1')).rejects.toThrow('inseguro')
  } finally { await rm(parent, { recursive: true, force: true }) }
})
