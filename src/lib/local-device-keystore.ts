/** Encrypted Ed25519 identity and explicit SaaS-signing trust for a local server. */
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync,
  randomBytes, scrypt, createHash, type KeyObject } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { localSaasOrigin } from './local-device-http'

const fingerprint = (key: KeyObject) => createHash('sha256')
  .update(key.export({ type: 'spki', format: 'der' }) as Buffer).digest('hex')
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const CONFIG = 'device.json'
const IDENTITY = 'identity.enc.json'
const PUBLIC = 'identity.public.pem'
const KDF_N = 1 << 16

const configSchema = z.object({ version: z.literal(1), tenantId: z.string().min(1).max(200),
  baseUrl: z.string().url(), deviceId: z.string().min(1).max(200).nullable(),
  publicKeySpkiSha256: z.string().regex(/^[0-9a-f]{64}$/), createdAt: z.string().datetime({ offset: true }),
}).strict()
type LocalDeviceConfig = z.infer<typeof configSchema>
const envelopeSchema = z.object({ version: z.literal(1), cipher: z.literal('aes-256-gcm'),
  kdf: z.literal('scrypt-N65536-r8-p1'), salt: z.string(), iv: z.string(),
  tag: z.string(), ciphertext: z.string(),
}).strict()

function checkedRoot(root: string): string {
  if (!isAbsolute(root)) throw new Error('Raiz local deve ser absoluta.')
  const path = resolve(root)
  const repository = resolve(process.cwd())
  if (path === repository || path.startsWith(repository + sep)) {
    throw new Error('Identidade do desktop deve ficar fora do repositório.')
  }
  return path
}

async function requirePrivateRoot(root: string): Promise<string> {
  const path = checkedRoot(root)
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) {
    throw new Error('Diretório de identidade local inseguro.')
  }
  if (await realpath(path) !== path) throw new Error('Diretório de identidade redirecionado.')
  return path
}

async function readPrivateFile(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) {
    throw new Error('Arquivo de identidade local inseguro.')
  }
  return readFile(path, 'utf8')
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function writeAtomic(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    await syncFile(temporary)
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (passphrase.length < 20) throw new Error('Frase secreta deve ter pelo menos 20 caracteres.')
  return new Promise((resolveKey, reject) => scrypt(passphrase, salt, 32,
    { N: KDF_N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolveKey(key as Buffer)))
}

function aad(config: LocalDeviceConfig): Buffer {
  return Buffer.from(`edocbr.local-device.identity.v1\n${config.tenantId}\n${config.publicKeySpkiSha256}`, 'utf8')
}

export async function initializeLocalDevice(args: { root: string; tenantId: string; baseUrl: string;
  passphrase: string }): Promise<{ config: LocalDeviceConfig; publicKeyPem: string }> {
  const root = checkedRoot(args.root)
  localSaasOrigin(args.baseUrl)
  if (!args.tenantId || args.tenantId.length > 200) throw new Error('Câmara inválida.')
  await mkdir(root, { recursive: false, mode: 0o700 })
  try {
    await requirePrivateRoot(root)
    const keys = generateKeyPairSync('ed25519')
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const config: LocalDeviceConfig = { version: 1, tenantId: args.tenantId,
      baseUrl: args.baseUrl, deviceId: null, publicKeySpkiSha256: fingerprint(keys.publicKey),
      createdAt: new Date().toISOString() }
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = await deriveKey(args.passphrase, salt)
    let ciphertext: Buffer
    let tag: Buffer
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(aad(config))
      ciphertext = Buffer.concat([cipher.update(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string), cipher.final()])
      tag = cipher.getAuthTag()
    } finally { key.fill(0) }
    const envelope = { version: 1, cipher: 'aes-256-gcm', kdf: 'scrypt-N65536-r8-p1',
      salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64') }
    await writeFile(join(root, IDENTITY), JSON.stringify(envelope), { mode: 0o600, flag: 'wx' })
    await writeFile(join(root, PUBLIC), publicKeyPem, { mode: 0o600, flag: 'wx' })
    await writeFile(join(root, CONFIG), JSON.stringify(config), { mode: 0o600, flag: 'wx' })
    await mkdir(join(root, 'trusted-keys'), { mode: 0o700 })
    return { config, publicKeyPem }
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error }
}

async function readConfig(root: string): Promise<LocalDeviceConfig> {
  await requirePrivateRoot(root)
  const config = configSchema.parse(JSON.parse(await readPrivateFile(join(root, CONFIG))))
  localSaasOrigin(config.baseUrl)
  return config
}

/** Enrollment is one-time. Replacing a device requires a fresh identity and admin action. */
export async function enrollLocalDevice(root: string, deviceId: string): Promise<LocalDeviceConfig> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(deviceId)) throw new Error('ID do dispositivo inválido.')
  const path = checkedRoot(root)
  const config = await readConfig(path)
  if (config.deviceId && config.deviceId !== deviceId) throw new Error('Dispositivo já vinculado a outro ID.')
  if (config.deviceId === deviceId) return config
  const updated = { ...config, deviceId }
  await writeAtomic(join(path, CONFIG), JSON.stringify(updated))
  return updated
}

/** Fingerprint must be obtained independently of the PEM being imported. */
export async function trustLocalTransferKey(args: { root: string; keyId: string;
  publicKeyPem: string; expectedSpkiSha256: string }): Promise<string> {
  if (!keyIdPattern.test(args.keyId) || !/^[0-9a-f]{64}$/.test(args.expectedSpkiSha256)) {
    throw new Error('Identidade da chave confiável inválida.')
  }
  const root = checkedRoot(args.root)
  await readConfig(root)
  await requirePrivateRoot(join(root, 'trusted-keys'))
  const key = createPublicKey(args.publicKeyPem)
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('Chave confiável deve ser Ed25519.')
  const actual = fingerprint(key)
  if (actual !== args.expectedSpkiSha256) throw new Error('Impressão digital da chave da Câmara diverge.')
  const pem = key.export({ type: 'spki', format: 'pem' }).toString()
  const path = join(root, 'trusted-keys', `${args.keyId}.pem`)
  try { await writeFile(path, pem, { mode: 0o600, flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readPrivateFile(path) !== pem) throw error
  }
  return actual
}

export async function loadLocalDevice(args: { root: string; passphrase: string }): Promise<{
  config: LocalDeviceConfig; privateKey: KeyObject; trustedKeys: Map<string, KeyObject>
}> {
  const root = checkedRoot(args.root)
  const config = await readConfig(root)
  if (!config.deviceId) throw new Error('Dispositivo ainda não vinculado à Câmara.')
  const envelope = envelopeSchema.parse(JSON.parse(await readPrivateFile(join(root, IDENTITY))))
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Identidade cifrada inválida.')
  const key = await deriveKey(args.passphrase, salt)
  let privateKey: KeyObject
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad(config))
    decipher.setAuthTag(tag)
    const pem = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
    try { privateKey = createPrivateKey(pem) } finally { pem.fill(0) }
  } catch { throw new Error('Frase secreta ou identidade cifrada inválida.') }
  finally { key.fill(0) }
  if (privateKey.asymmetricKeyType !== 'ed25519' || fingerprint(createPublicKey(privateKey)) !== config.publicKeySpkiSha256) {
    throw new Error('Chave local diverge da identidade registrada.')
  }
  const trustedKeys = new Map<string, KeyObject>()
  await requirePrivateRoot(join(root, 'trusted-keys'))
  for (const file of await readdir(join(root, 'trusted-keys'))) {
    if (!file.endsWith('.pem')) throw new Error('Arquivo inesperado na confiança local.')
    const keyId = file.slice(0, -4)
    if (!keyIdPattern.test(keyId)) throw new Error('ID de chave confiável inválido.')
    const publicKey = createPublicKey(await readPrivateFile(join(root, 'trusted-keys', file)))
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Chave confiável inválida.')
    trustedKeys.set(keyId, publicKey)
  }
  if (!trustedKeys.size) throw new Error('Nenhuma chave pública da Câmara foi confiada.')
  return { config, privateKey, trustedKeys }
}
