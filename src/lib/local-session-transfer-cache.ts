/** Content-addressed partial download cache; never marks a session prepared. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
type Artifact = { id: string; sha256: string; sizeBytes: number }

function cacheDirectory(root: string, tenantId: string, sessionId: string, manifestSha256: string): string {
  if (!isAbsolute(root) || !/^[0-9a-f]{64}$/.test(manifestSha256)) throw new Error('Cache de transferência inválido.')
  return join(root, 'tenants', digest(tenantId), 'sessions', digest(sessionId), 'partial', manifestSha256)
}

function artifactPath(directory: string, artifact: Artifact): string {
  return join(directory, digest(artifact.id) + '.bin')
}

export async function readCachedTransferArtifact(args: {
  root: string; tenantId: string; sessionId: string; manifestSha256: string; artifact: Artifact
}): Promise<Uint8Array | null> {
  const path = artifactPath(cacheDirectory(args.root, args.tenantId, args.sessionId, args.manifestSha256), args.artifact)
  let handle
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size !== args.artifact.sizeBytes) return null
    const bytes = await handle.readFile()
    return digest(bytes) === args.artifact.sha256 ? bytes : null
  } finally { await handle.close() }
}

export async function cacheTransferArtifact(args: {
  root: string; tenantId: string; sessionId: string; manifestSha256: string; artifact: Artifact; bytes: Uint8Array
}): Promise<void> {
  if (args.bytes.byteLength !== args.artifact.sizeBytes || digest(args.bytes) !== args.artifact.sha256) {
    throw new Error('Artefato recebido diverge do manifesto assinado.')
  }
  const directory = cacheDirectory(args.root, args.tenantId, args.sessionId, args.manifestSha256)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.download-${randomUUID()}`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(args.bytes); await handle.sync() } finally { await handle.close() }
    await rename(temporary, artifactPath(directory, args.artifact))
  } finally { await rm(temporary, { force: true }) }
}

export async function clearTransferCache(args: { root: string; tenantId: string; sessionId: string }): Promise<void> {
  if (!isAbsolute(args.root)) throw new Error('Raiz de cache inválida.')
  const path = join(args.root, 'tenants', digest(args.tenantId), 'sessions', digest(args.sessionId), 'partial')
  await rm(path, { recursive: true, force: true })
}

/** Keep the current signed manifest and at most two recent interrupted revisions. */
export async function pruneTransferCache(args: {
  root: string; tenantId: string; sessionId: string; keepManifestSha256: string; now?: Date
}): Promise<number> {
  const current = cacheDirectory(args.root, args.tenantId, args.sessionId, args.keepManifestSha256)
  const partial = join(current, '..')
  let entries
  try { entries = await readdir(partial, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
  const candidates: Array<{ path: string; mtimeMs: number }> = []
  for (const entry of entries) {
    if (!/^[0-9a-f]{64}$/.test(entry.name)) continue
    const path = join(partial, entry.name)
    let info
    try { info = await lstat(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (entry.name === args.keepManifestSha256) {
      if (!info.isDirectory()) throw new Error('Cache da revisão corrente não é um diretório seguro.')
      continue
    }
    if (info.isSymbolicLink()) { await rm(path, { force: true }); continue }
    if (info.isDirectory()) candidates.push({ path, mtimeMs: info.mtimeMs })
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const cutoff = (args.now ?? new Date()).getTime() - 7 * 86400_000
  let removed = 0
  for (const [index, candidate] of candidates.entries()) {
    if (index < 2 && candidate.mtimeMs >= cutoff) continue
    await rm(candidate.path, { recursive: true, force: true })
    removed++
  }
  return removed
}
