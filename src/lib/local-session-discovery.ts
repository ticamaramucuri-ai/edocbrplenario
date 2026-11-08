/** Discover published preparations and synchronize them into the local store. */
import type { KeyObject } from 'node:crypto'
import { z } from 'zod'
import { signedLocalDeviceGet } from './local-device-http'
import { downloadAndPrepareSession } from './local-device-client'
import type { PreparedRevision } from './local-session-package-store'

const sessionSchema = z.object({
  id: z.string().min(1).max(200), number: z.number().int().positive(), year: z.number().int().positive(),
  scheduledAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  revisionId: z.string().nullable(), revisionNumber: z.number().int().positive().nullable(),
  readyForTransfer: z.boolean(),
}).strict()
const pageSchema = z.object({ sessions: z.array(sessionSchema).max(100),
  nextCursor: z.string().min(1).max(200).nullable() }).strict()

type ClientIdentity = {
  baseUrl: string
  tenantId: string
  deviceId: string
  privateKey: KeyObject
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export type DiscoveredPreparation = z.infer<typeof sessionSchema>

export async function discoverPreparedSessions(args: ClientIdentity): Promise<DiscoveredPreparation[]> {
  const fetcher = args.fetchImpl ?? fetch
  const found: DiscoveredPreparation[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const pathAndQuery = `/api/v1/local-preparations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    const { url, init } = signedLocalDeviceGet({ ...args, pathAndQuery })
    const response = await fetcher(url, { ...init, signal: args.signal })
    if (!response.ok) throw new Error(`Descoberta de sessões recusada pelo SaaS (HTTP ${response.status}).`)
    if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      throw new Error('Resposta de descoberta em formato inválido.')
    }
    const page = pageSchema.parse(await response.json())
    for (const session of page.sessions) {
      if (!seen.has(session.id)) { seen.add(session.id); found.push(session) }
    }
    if (!page.nextCursor) return found
    if (page.nextCursor === cursor || !page.sessions.length) throw new Error('Paginação de sessões inválida.')
    cursor = page.nextCursor
  }
  throw new Error('Limite de páginas de preparação excedido.')
}

/** One cycle continues other sessions after an individual transfer failure. */
export async function synchronizePreparedSessions(args: ClientIdentity & {
  localRoot: string
  trustedKeys: ReadonlyMap<string, KeyObject>
}): Promise<{ prepared: PreparedRevision[]; failed: Array<{ sessionId: string; reason: string }>; skipped: string[] }> {
  const sessions = await discoverPreparedSessions(args)
  const prepared: PreparedRevision[] = []
  const failed: Array<{ sessionId: string; reason: string }> = []
  const skipped: string[] = []
  for (const session of sessions) {
    if (!session.readyForTransfer) { skipped.push(session.id); continue }
    try { prepared.push(await downloadAndPrepareSession({ ...args, sessionId: session.id })) }
    catch (error) { failed.push({ sessionId: session.id, reason: error instanceof Error ? error.message : 'Falha desconhecida' }) }
  }
  return { prepared, failed, skipped }
}
