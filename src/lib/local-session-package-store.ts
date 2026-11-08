/** Filesystem preparation store for one designated chamber server.
 * No LAN API or session authority is granted by importing a package.
 */
import { createHash, randomUUID, type KeyObject } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { canonicalManifest, verifyPreparedPackage, type TransferManifestV1, type TransferSignatureV1 } from './session-transfer-contract'

const MAX_ARTIFACTS = 500
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const segment = (value: string) => digest(value)

export type PreparedRevision = {
  tenantId: string
  sessionId: string
  revisionId: string
  revisionNumber: number
  manifestSha256: string
  signature: TransferSignatureV1
  importedAt: string
}

type ImportArgs = {
  root: string
  manifest: TransferManifestV1
  signature: TransferSignatureV1
  bytesById: ReadonlyMap<string, Uint8Array>
  expectedTenantId: string
  expectedSessionId: string
  trustedKeys: ReadonlyMap<string, KeyObject>
}

function sessionPath(root: string, tenantId: string, sessionId: string): string {
  if (!isAbsolute(root)) throw new Error('Raiz de armazenamento local deve ser absoluta.')
  return join(root, 'tenants', segment(tenantId), 'sessions', segment(sessionId))
}

async function currentRevision(path: string): Promise<PreparedRevision | null> {
  let raw: string
  try { raw = await readFile(join(path, 'current.json'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('revisionNumber' in value) ||
      !Number.isInteger(value.revisionNumber) || !('revisionId' in value) || typeof value.revisionId !== 'string' ||
      !('manifestSha256' in value) || typeof value.manifestSha256 !== 'string') {
    throw new Error('Ponteiro local de revisão inválido; intervenção necessária.')
  }
  return value as PreparedRevision
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function syncDirectory(path: string): Promise<void> {
  // Directory fsync is available on Linux; Windows filesystems may reject it.
  try { await syncFile(path) } catch (error) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}

/** Import is serialized by a per-session lock. A stale lock requires operator recovery. */
export async function importPreparedPackage(args: ImportArgs): Promise<PreparedRevision> {
  const path = sessionPath(args.root, args.expectedTenantId, args.expectedSessionId)
  if (args.manifest.artifacts.length > MAX_ARTIFACTS ||
      args.manifest.artifacts.reduce((sum, item) => sum + item.sizeBytes, 0) > MAX_TOTAL_BYTES) {
    throw new Error('Pacote excede limite de armazenamento da importação inicial.')
  }
  await mkdir(path, { recursive: true, mode: 0o700 })
  const lock = join(path, '.import-lock')
  try { await mkdir(lock) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Outra importação está em andamento ou exige recuperação manual.')
    throw error
  }
  try {
    const current = await currentRevision(path)
    const manifest = verifyPreparedPackage({ manifest: args.manifest, signature: args.signature,
      bytesById: args.bytesById, expectedTenantId: args.expectedTenantId,
      expectedSessionId: args.expectedSessionId, minimumRevisionNumber: current?.revisionNumber ?? 0,
      trustedKeys: args.trustedKeys })
    const manifestJson = canonicalManifest(manifest)
    const manifestSha256 = digest(manifestJson)
    if (current?.revisionNumber === manifest.revisionNumber) {
      if (current.revisionId !== manifest.revisionId || current.manifestSha256 !== manifestSha256) {
        throw new Error('Mesmo número de revisão com conteúdo divergente; intervenção necessária.')
      }
      await readPreparedPackage({ root: args.root, expectedTenantId: args.expectedTenantId,
        expectedSessionId: args.expectedSessionId, trustedKeys: args.trustedKeys })
      return current
    }
    const target = join(path, 'revisions', `${String(manifest.revisionNumber).padStart(8, '0')}-${segment(manifest.revisionId)}`)
    // A crash after moving a complete revision but before updating current.json
    // can leave an orphan. The lock proves no other import is using it.
    try { await stat(target); await rm(target, { recursive: true, force: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const staging = join(path, `.import-${randomUUID()}`)
    await mkdir(join(staging, 'artifacts'), { recursive: true, mode: 0o700 })
    try {
      const files: Record<string, string> = {}
      for (const [index, item] of manifest.artifacts.entries()) {
        const file = `${String(index).padStart(6, '0')}.bin`
        const filePath = join(staging, 'artifacts', file)
        await writeFile(filePath, args.bytesById.get(item.id)!, { mode: 0o600, flag: 'wx' })
        await syncFile(filePath)
        files[item.id] = file
      }
      const metadata = { manifest, signature: args.signature, files }
      const metadataPath = join(staging, 'package.json')
      await writeFile(metadataPath, JSON.stringify(metadata), { mode: 0o600, flag: 'wx' })
      await syncFile(metadataPath)
      await syncDirectory(join(staging, 'artifacts'))
      await syncDirectory(staging)
      await mkdir(join(path, 'revisions'), { recursive: true, mode: 0o700 })
      await rename(staging, target)
      await syncDirectory(join(path, 'revisions'))
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
    const prepared: PreparedRevision = { tenantId: manifest.tenantId, sessionId: manifest.sessionId,
      revisionId: manifest.revisionId, revisionNumber: manifest.revisionNumber, manifestSha256,
      signature: args.signature, importedAt: new Date().toISOString() }
    const pointer = join(path, `.current-${randomUUID()}.json`)
    try {
      await writeFile(pointer, JSON.stringify(prepared), { mode: 0o600, flag: 'wx' })
      await syncFile(pointer)
      await rename(pointer, join(path, 'current.json'))
      await syncDirectory(path)
    } finally { await rm(pointer, { force: true }) }
    return prepared
  } finally { await rm(lock, { recursive: true, force: true }) }
}

/** Reverify persisted bytes before presenting a revision as ready to operate. */
export async function readPreparedPackage(args: {
  root: string
  expectedTenantId: string
  expectedSessionId: string
  trustedKeys: ReadonlyMap<string, KeyObject>
}): Promise<{ prepared: PreparedRevision; manifest: TransferManifestV1; bytesById: Map<string, Uint8Array> }> {
  const path = sessionPath(args.root, args.expectedTenantId, args.expectedSessionId)
  const prepared = await currentRevision(path)
  if (!prepared) throw new Error('Sessão não preparada localmente.')
  if (prepared.tenantId !== args.expectedTenantId || prepared.sessionId !== args.expectedSessionId) {
    throw new Error('Ponteiro pertence a outra Câmara ou sessão.')
  }
  const revisionPath = join(path, 'revisions', `${String(prepared.revisionNumber).padStart(8, '0')}-${segment(prepared.revisionId)}`)
  const metadata = JSON.parse(await readFile(join(revisionPath, 'package.json'), 'utf8')) as {
    manifest: TransferManifestV1; signature: TransferSignatureV1; files: Record<string, string>
  }
  if (digest(canonicalManifest(metadata.manifest)) !== prepared.manifestSha256 ||
      metadata.manifest.revisionId !== prepared.revisionId || metadata.manifest.revisionNumber !== prepared.revisionNumber ||
      !metadata.files || Object.keys(metadata.files).length !== metadata.manifest.artifacts.length) {
    throw new Error('Metadados locais divergem do ponteiro da sessão.')
  }
  const bytesById = new Map<string, Uint8Array>()
  for (const [index, item] of metadata.manifest.artifacts.entries()) {
    const expectedFile = `${String(index).padStart(6, '0')}.bin`
    if (metadata.files[item.id] !== expectedFile) throw new Error('Mapa local de artefatos inválido.')
    bytesById.set(item.id, await readFile(join(revisionPath, 'artifacts', expectedFile)))
  }
  const manifest = verifyPreparedPackage({ manifest: metadata.manifest, signature: metadata.signature,
    bytesById, expectedTenantId: args.expectedTenantId, expectedSessionId: args.expectedSessionId,
    expectedRevisionId: prepared.revisionId, minimumRevisionNumber: prepared.revisionNumber,
    trustedKeys: args.trustedKeys })
  return { prepared, manifest, bytesById }
}
