/** Offline inventory; every ready entry is rechecked against its signed bytes. */
import { createHash, type KeyObject } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { readPreparedPackage, type PreparedRevision } from './local-session-package-store'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export type LocalPreparationStatus = {
  sessionId: string
  state: 'ready' | 'corrupt'
  prepared?: PreparedRevision
  artifactCount?: number
  totalBytes?: number
  reason?: string
}

export async function inspectLocalPreparations(args: {
  root: string
  tenantId: string
  trustedKeys: ReadonlyMap<string, KeyObject>
}): Promise<LocalPreparationStatus[]> {
  if (!isAbsolute(args.root)) throw new Error('Raiz de armazenamento local deve ser absoluta.')
  const directory = join(args.root, 'tenants', hash(args.tenantId), 'sessions')
  let entries: Dirent<string>[]
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Diretório local de sessões inseguro.')
    entries = await readdir(directory, { withFileTypes: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const statuses: LocalPreparationStatus[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) {
      statuses.push({ sessionId: entry.name, state: 'corrupt', reason: 'Diretório local inesperado.' })
      continue
    }
    let sessionId = entry.name
    try {
      const pointer = JSON.parse(await readFile(join(directory, entry.name, 'current.json'), 'utf8')) as { sessionId?: unknown }
      if (typeof pointer.sessionId !== 'string' || hash(pointer.sessionId) !== entry.name) {
        throw new Error('Ponteiro local diverge do diretório da sessão.')
      }
      sessionId = pointer.sessionId
      const { prepared, manifest } = await readPreparedPackage({ root: args.root,
        expectedTenantId: args.tenantId, expectedSessionId: sessionId, trustedKeys: args.trustedKeys })
      statuses.push({ sessionId, state: 'ready', prepared, artifactCount: manifest.artifacts.length,
        totalBytes: manifest.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0) })
    } catch (error) {
      statuses.push({ sessionId, state: 'corrupt',
        reason: error instanceof Error ? error.message : 'Erro de integridade local.' })
    }
  }
  return statuses
}
