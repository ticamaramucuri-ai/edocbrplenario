/**
 * Cliente de reconciliação desktop -> SaaS: envia lotes ordenados do diário
 * local assinado para POST /api/v1/sessions/:id/authority/reconcile e retorna
 * os sequenciais confirmados (ackedSeqs) e eventos em quarentena.
 */
import type { LocalJournalEvent } from './local-event-journal'

export type ReconcileBatchResult = {
  reconciled: boolean
  sessionId: string
  epoch: number
  ackedSeqs: number[]
  appliedCount: number
  deduplicatedCount: number
  quarantined: Array<{ seq: number; commandId: string; reason: string }>
  lastAckedSeq: number
}

export async function pushLocalJournalBatch(args: {
  baseUrl: string
  sessionId: string
  deviceId: string
  epoch: number
  events: LocalJournalEvent[]
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
}): Promise<ReconcileBatchResult> {
  if (args.events.length === 0) {
    return {
      reconciled: true,
      sessionId: args.sessionId,
      epoch: args.epoch,
      ackedSeqs: [],
      appliedCount: 0,
      deduplicatedCount: 0,
      quarantined: [],
      lastAckedSeq: 0,
    }
  }

  const ordered = [...args.events].sort((a, b) => a.sequence - b.sequence).slice(0, 200)
  const payload = {
    deviceId: args.deviceId,
    epoch: args.epoch,
    events: ordered.map((ev) => ({
      seq: ev.sequence,
      commandId: ev.commandId,
      kind: ev.eventType,
      payload: (ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as Record<string, unknown>,
      occurredAt: ev.createdAt,
      entrySha256: ev.eventHash,
    })),
  }

  const doFetch = args.fetchImpl ?? fetch
  const url = `${args.baseUrl.replace(/\/+$/, '')}/api/v1/sessions/${encodeURIComponent(args.sessionId)}/authority/reconcile`
  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.headers ?? {}),
    },
    body: JSON.stringify(payload),
  })

  const json = (await res.json().catch(() => ({}))) as Partial<ReconcileBatchResult> & { detail?: string; title?: string }
  if (!res.ok) {
    throw new Error(json.detail || json.title || `Falha na reconciliação (HTTP ${res.status}).`)
  }

  const ackedSeqs = Array.isArray(json.ackedSeqs) ? json.ackedSeqs : []
  const lastAckedSeq = ackedSeqs.length > 0 ? Math.max(...ackedSeqs) : 0
  return {
    reconciled: json.reconciled === true,
    sessionId: json.sessionId ?? args.sessionId,
    epoch: json.epoch ?? args.epoch,
    ackedSeqs,
    appliedCount: json.appliedCount ?? 0,
    deduplicatedCount: json.deduplicatedCount ?? 0,
    quarantined: Array.isArray(json.quarantined) ? json.quarantined : [],
    lastAckedSeq,
  }
}
