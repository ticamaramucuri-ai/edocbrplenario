/** Signing-key custody for web → local preparation packages.
 * Keys are provisioned outside the repository and never returned to callers.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import { signPreparedPackage, type TransferManifestV1, type TransferSignatureV1 } from '@/lib/session-transfer-contract'

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const keyIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

export type ActiveTransferKey = {
  keyId: string
  publicKeySpkiSha256: string
}

function tenantPath(root: string, tenantId: string): string {
  if (!isAbsolute(root)) throw new Error('Diretório de chaves deve ser absoluto.')
  if (!tenantId) throw new Error('Câmara obrigatória para assinatura.')
  return join(root, 'tenants', sha256(tenantId))
}

async function assertSafeDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0) throw new Error('Diretório de chaves inválido.')
  const actual = await realpath(path)
  if (actual !== path) throw new Error('Diretório de chaves redirecionado.')
}

async function readActive(path: string): Promise<ActiveTransferKey> {
  const activePath = join(path, 'active.json')
  if ((await lstat(activePath)).isSymbolicLink()) throw new Error('Ponteiro de chave não pode ser symlink.')
  const value: unknown = JSON.parse(await readFile(activePath, 'utf8'))
  if (!value || typeof value !== 'object' || !('keyId' in value) || !('publicKeySpkiSha256' in value) ||
      typeof value.keyId !== 'string' || !keyIdPattern.test(value.keyId) ||
      typeof value.publicKeySpkiSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.publicKeySpkiSha256)) {
    throw new Error('Ponteiro de chave ativo inválido.')
  }
  return value as ActiveTransferKey
}

function publicHash(publicKey: KeyObject): string {
  return sha256(publicKey.export({ format: 'der', type: 'spki' }) as Buffer)
}

/** Provision or rotate one tenant key. The caller must protect the root directory. */
export async function provisionTransferSigningKey(args: { root: string; tenantId: string }): Promise<{
  active: ActiveTransferKey; publicKeyPem: string
}> {
  const path = tenantPath(args.root, args.tenantId)
  await mkdir(path, { recursive: true, mode: 0o700 })
  await assertSafeDirectory(args.root)
  await assertSafeDirectory(join(args.root, 'tenants'))
  await assertSafeDirectory(path)
  const keyId = `k-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privatePath = join(path, `${keyId}.pem`)
  const publicPath = join(path, `${keyId}.public.pem`)
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  await writeFile(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
  await chmod(privatePath, 0o600)
  await writeFile(publicPath, publicKeyPem, { mode: 0o644, flag: 'wx' })
  const active: ActiveTransferKey = { keyId, publicKeySpkiSha256: publicHash(publicKey) }
  const temporary = join(path, `.active-${randomBytes(8).toString('hex')}.json`)
  try {
    await writeFile(temporary, JSON.stringify(active), { mode: 0o600, flag: 'wx' })
    const handle = await open(temporary, 'r')
    try { await handle.sync() } finally { await handle.close() }
    await rename(temporary, join(path, 'active.json'))
  } finally { await rm(temporary, { force: true }) }
  return { active, publicKeyPem }
}

export async function loadActiveTransferSigningKey(args: { root: string; tenantId: string }): Promise<{
  active: ActiveTransferKey; privateKey: KeyObject; publicKey: KeyObject
}> {
  const path = tenantPath(args.root, args.tenantId)
  await assertSafeDirectory(args.root)
  await assertSafeDirectory(join(args.root, 'tenants'))
  await assertSafeDirectory(path)
  const active = await readActive(path)
  const privatePath = join(path, `${active.keyId}.pem`)
  const info = await lstat(privatePath)
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('Arquivo de chave privada inseguro.')
  }
  const resolved = await realpath(privatePath)
  if (!resolved.startsWith(path + sep)) throw new Error('Chave fora do diretório da Câmara.')
  const privateKey = createPrivateKey(await readFile(privatePath))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Chave de transferência deve ser Ed25519.')
  const publicKey = createPublicKey(privateKey)
  if (publicHash(publicKey) !== active.publicKeySpkiSha256) throw new Error('Chave ativa diverge da impressão pública registrada.')
  return { active, privateKey, publicKey }
}

export async function signSessionTransferCandidate(args: {
  root: string
  tenantId: string
  manifest: TransferManifestV1
  bytesById: ReadonlyMap<string, Uint8Array>
}): Promise<{ signature: TransferSignatureV1; publicKeySpkiSha256: string }> {
  if (args.manifest.tenantId !== args.tenantId) throw new Error('Candidato pertence a outra Câmara.')
  const { active, privateKey } = await loadActiveTransferSigningKey(args)
  return { signature: signPreparedPackage(args.manifest, args.bytesById, active.keyId, privateKey),
    publicKeySpkiSha256: active.publicKeySpkiSha256 }
}
