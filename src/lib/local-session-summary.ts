/** Public-safe metadata from a verified local preparation; no document bytes or authority. */
import type { KeyObject } from 'node:crypto'
import { inspectLocalPreparations } from './local-preparation-status'
import { readPreparedPackage } from './local-session-package-store'

export type LocalSessionSummary = {
  sessionId: string
  revisionNumber: number
  agenda: Array<{ title: string; order: number }>
  documents: Array<{ name: string; mimeType: string; sizeBytes: number }>
  canVote: false
}

export async function readLocalSessionSummary(args: {
  root: string
  tenantId: string
  sessionId: string
  trustedKeys: ReadonlyMap<string, KeyObject>
}): Promise<LocalSessionSummary> {
  const statuses = await inspectLocalPreparations({ root: args.root, tenantId: args.tenantId,
    trustedKeys: args.trustedKeys })
  const status = statuses.find((item) => item.sessionId === args.sessionId)
  if (!status || status.state !== 'ready') throw new Error('Sessão não preparada para leitura local.')
  const { manifest } = await readPreparedPackage({ root: args.root, expectedTenantId: args.tenantId,
    expectedSessionId: args.sessionId, trustedKeys: args.trustedKeys })
  return {
    sessionId: args.sessionId,
    revisionNumber: manifest.revisionNumber,
    agenda: manifest.agendaSnapshot.map((item, index) => ({
      title: typeof item.title === 'string' && item.title.trim() ? item.title : 'Item sem título',
      order: typeof item.order === 'number' && Number.isInteger(item.order) ? item.order : index + 1,
    })),
    documents: manifest.artifacts.map((item) => ({ name: item.name, mimeType: item.mimeType,
      sizeBytes: item.sizeBytes })),
    canVote: false,
  }
}
