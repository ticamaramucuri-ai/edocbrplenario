/** Content-addressed partial download cache; never marks a session prepared. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
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
