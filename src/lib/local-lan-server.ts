/**
 * Servidor HTTP + WebSocket local na LAN para o edocBR Plenário Desktop.
 * Atende a interface desktop das 6 telas, tablets PWA e telões na rede interna,
 * gravando comandos no diário criptográfico assinado (local-event-journal.ts).
 */
import type { KeyObject } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import { openLocalEventJournal, type LocalJournalEvent } from './local-event-journal'
import { inspectLocalPreparations } from './local-preparation-status'
import { pushLocalJournalBatch } from './local-reconcile-client'
import { renderDesktopAppHtml } from './local-desktop-ui'

type LanClientData = { id: string; kind: string; connectedAt: string }

export type LocalSessionSnapshot = {
  sessionId: string
  presentParliamentarianIds: string[]
  displayFrozen: boolean
  activeVoting: {
    id: string
    question: string
    mode: string
    status: 'open' | 'closed'
    votes: Record<string, string>
    counts: { sim: number; nao: number; abstencao: number }
  } | null
  lastSequence: number
}

function computeSnapshot(sessionId: string, events: LocalJournalEvent[]): LocalSessionSnapshot {
  const present = new Set<string>()
  let displayFrozen = false
  let activeVoting: LocalSessionSnapshot['activeVoting'] = null

  for (const ev of events) {
    const p = (ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as Record<string, unknown>
    if (ev.eventType === 'attendance.check_in' && typeof p.parliamentarianId === 'string') {
      present.add(p.parliamentarianId)
    } else if (ev.eventType === 'attendance.check_out' && typeof p.parliamentarianId === 'string') {
      present.delete(p.parliamentarianId)
    } else if (ev.eventType === 'display.freeze') {
      displayFrozen = p.frozen === true
    } else if (ev.eventType === 'voting.opened' && typeof p.votingId === 'string') {
      activeVoting = {
        id: p.votingId,
        question: typeof p.question === 'string' ? p.question : 'Votação Local',
        mode: typeof p.mode === 'string' ? p.mode : 'nominal',
        status: 'open',
        votes: {},
        counts: { sim: 0, nao: 0, abstencao: 0 },
      }
    } else if (ev.eventType === 'vote.cast' && activeVoting && p.votingId === activeVoting.id) {
      if (typeof p.parliamentarianId === 'string' && typeof p.value === 'string') {
        activeVoting.votes[p.parliamentarianId] = p.value
      }
    } else if (ev.eventType === 'voting.closed' && activeVoting && p.votingId === activeVoting.id) {
      activeVoting.status = 'closed'
    }
  }

  if (activeVoting) {
    const counts = { sim: 0, nao: 0, abstencao: 0 }
    for (const v of Object.values(activeVoting.votes)) {
      if (v === 'sim') counts.sim += 1
      else if (v === 'nao') counts.nao += 1
      else if (v === 'abstencao') counts.abstencao += 1
    }
    activeVoting.counts = counts
  }

  return {
    sessionId,
    presentParliamentarianIds: [...present],
    displayFrozen,
    activeVoting,
    lastSequence: events.length > 0 ? events[events.length - 1].sequence : 0,
  }
}

export function startLocalLanServer(args: {
  root: string
  tenantId: string
  deviceId: string
  baseUrl: string
  privateKey: KeyObject
  trustedKeys: ReadonlyMap<string, KeyObject>
  hostname?: string
  port?: number
  reconcileHeaders?: Record<string, string>
}) {
  const journal = openLocalEventJournal({
    root: args.root,
    tenantId: args.tenantId,
    deviceId: args.deviceId,
    privateKey: args.privateKey,
  })
  const clients = new Map<string, { ws: ServerWebSocket<LanClientData>; meta: LanClientData }>()

  const broadcast = (event: string, data: unknown) => {
    const msg = JSON.stringify({ event, data, at: new Date().toISOString() })
    for (const { ws } of clients.values()) {
      try {
        ws.send(msg)
      } catch {
        // cliente desconectado
      }
    }
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })

  const server = Bun.serve<LanClientData>({
    hostname: args.hostname ?? '127.0.0.1',
    port: args.port ?? 3443,
    async fetch(req, srv) {
      const url = new URL(req.url)
      const path = url.pathname

      if (path === '/ws') {
        const kind = url.searchParams.get('kind') || 'unknown'
        const ok = srv.upgrade(req, {
          data: { id: crypto.randomUUID(), kind, connectedAt: new Date().toISOString() },
        })
        return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
      }

      if (path === '/health' && req.method === 'GET') {
        return json({ ok: true, service: 'edocbr-local-desktop', tenantId: args.tenantId, deviceId: args.deviceId })
      }

      if (path === '/' && req.method === 'GET') {
        return new Response(
          renderDesktopAppHtml({
            tenantId: args.tenantId,
            deviceId: args.deviceId,
            baseUrl: args.baseUrl,
            lanPort: srv.port ?? args.port ?? 3443,
          }),
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      }

      try {
        if (path === '/api/local/status' && req.method === 'GET') {
          let journalVerified = false
          try {
            journal.verify()
            journalVerified = true
          } catch {
            journalVerified = false
          }
          const sessions = await inspectLocalPreparations({
            root: args.root,
            tenantId: args.tenantId,
            trustedKeys: args.trustedKeys,
          })
          return json({
            tenantId: args.tenantId,
            deviceId: args.deviceId,
            baseUrl: args.baseUrl,
            journalVerified,
            sessions,
            lanClients: [...clients.values()].map((c) => c.meta),
          })
        }

        const sessionMatch = /^\/api\/local\/sessions\/([^/]+)\/(.+)$/.exec(path)
        if (sessionMatch) {
          const sessionId = decodeURIComponent(sessionMatch[1])
          const sub = sessionMatch[2]

          if (sub === 'preflight' && req.method === 'GET') {
            const sessions = await inspectLocalPreparations({
              root: args.root,
              tenantId: args.tenantId,
              trustedKeys: args.trustedKeys,
            })
            const found = sessions.find((s) => s.sessionId === sessionId)
            let journalVerified = false
            try {
              journal.verify()
              journalVerified = true
            } catch {
              journalVerified = false
            }
            const events = journal.list(sessionId, 0)
            return json({
              sessionId,
              packageState: found?.state ?? 'missing',
              artifactCount: found?.artifactCount ?? 0,
              journalVerified,
              journalCount: events.length,
              ready: found?.state === 'ready' && journalVerified,
            })
          }

          if (sub === 'snapshot' && req.method === 'GET') {
            const events = journal.list(sessionId, 0)
            return json(computeSnapshot(sessionId, events))
          }

          if (sub === 'journal' && req.method === 'GET') {
            const after = Number(url.searchParams.get('after') ?? '0') || 0
            return json({ sessionId, events: journal.list(sessionId, after) })
          }

          if (req.method === 'POST') {
            const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
            const events = journal.list(sessionId, 0)
            const expectedSequence = events.length > 0 ? events[events.length - 1].sequence : 0
            const commandId = typeof body.commandId === 'string' ? body.commandId : crypto.randomUUID()

            const appendAndBroadcast = (eventType: string, payload: unknown) => {
              const ev = journal.append({
                sessionId,
                commandId,
                expectedSequence,
                eventType,
                actorId: typeof body.actorId === 'string' ? body.actorId : 'local-operator',
                payload,
              })
              broadcast(eventType, { sessionId, sequence: ev.sequence, eventHash: ev.eventHash })
              return ev
            }

            if (sub === 'attendance') {
              const kind = body.kind === 'check_out' ? 'attendance.check_out' : 'attendance.check_in'
              if (typeof body.parliamentarianId !== 'string' || !body.parliamentarianId) {
                return json({ error: 'parliamentarianId é obrigatório.' }, 422)
              }
              const ev = appendAndBroadcast(kind, { parliamentarianId: body.parliamentarianId })
              return json({ ok: true, event: ev })
            }

            if (sub === 'votings') {
              const votingId = typeof body.votingId === 'string' ? body.votingId : crypto.randomUUID()
              const ev = appendAndBroadcast('voting.opened', {
                votingId,
                question: typeof body.question === 'string' ? body.question : 'Deliberação Local',
                mode: typeof body.mode === 'string' ? body.mode : 'nominal',
              })
              return json({ ok: true, votingId, event: ev }, 201)
            }

            if (sub === 'votes') {
              if (
                typeof body.votingId !== 'string' ||
                typeof body.parliamentarianId !== 'string' ||
                typeof body.value !== 'string'
              ) {
                return json({ error: 'votingId, parliamentarianId e value são obrigatórios.' }, 422)
              }
              const ev = appendAndBroadcast('vote.cast', {
                votingId: body.votingId,
                parliamentarianId: body.parliamentarianId,
                value: body.value,
              })
              return json({
                ok: true,
                receipt: { sequence: ev.sequence, eventHash: ev.eventHash, commandId: ev.commandId },
              })
            }

            if (sub === 'votings/close') {
              if (typeof body.votingId !== 'string') return json({ error: 'votingId é obrigatório.' }, 422)
              const ev = appendAndBroadcast('voting.closed', { votingId: body.votingId })
              const snap = computeSnapshot(sessionId, journal.list(sessionId, 0))
              return json({ ok: true, event: ev, voting: snap.activeVoting })
            }

            if (sub === 'display/freeze') {
              const ev = appendAndBroadcast('display.freeze', { frozen: body.frozen === true })
              return json({ ok: true, event: ev })
            }

            if (sub === 'reconcile') {
              const epoch = typeof body.epoch === 'number' ? body.epoch : 1
              const after = typeof body.afterSequence === 'number' ? body.afterSequence : 0
              const pending = journal.list(sessionId, after)
              const result = await pushLocalJournalBatch({
                baseUrl: args.baseUrl,
                sessionId,
                deviceId: args.deviceId,
                epoch,
                events: pending,
                headers: args.reconcileHeaders,
              })
              return json(result)
            }
          }
        }

        return json({ error: 'Rota local não encontrada.' }, 404)
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Erro interno no servidor local.' }, 400)
      }
    },
    websocket: {
      open(ws) {
        clients.set(ws.data.id, { ws, meta: ws.data })
      },
      message() {
        // ping/keepalive silencioso
      },
      close(ws) {
        clients.delete(ws.data.id)
      },
    },
  })

  return {
    server,
    port: server.port,
    close() {
      server.stop(true)
      journal.close()
    },
  }
}
