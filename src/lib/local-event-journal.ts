/** Durable, signed local event journal. Domain commands and session authority are separate gates. */
import { Database } from 'bun:sqlite'
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { closeSync, lstatSync, openSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const GENESIS = '0'.repeat(64)
const FORMAT_VERSION = 1
const MAX_PAYLOAD_BYTES = 64 * 1024

type EventRow = {
  session_id: string; sequence: number; command_id: string; event_type: string; actor_id: string
  payload_json: string; previous_hash: string; event_hash: string; signature_base64: string; created_at: string
}
type CursorRow = { last_sequence: number; last_hash: string }
type ScopeRow = { tenant_id: string; device_id: string; public_key_sha256: string; format_version: number }
export type LocalJournalEvent = {
  tenantId: string; deviceId: string; sessionId: string; sequence: number; commandId: string
  eventType: string; actorId: string; payload: unknown; previousHash: string; eventHash: string
  signatureBase64: string; createdAt: string
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('Evento local contém dado não canônico.')
}

function hashEvent(event: Omit<LocalJournalEvent, 'eventHash' | 'signatureBase64'>): string {
  const { tenantId, deviceId, sessionId, sequence, commandId, eventType, actorId, payload,
    previousHash, createdAt } = event
  return createHash('sha256').update('edocbr.local-event.v1\n').update(canonical({ tenantId, deviceId,
    sessionId, sequence, commandId, eventType, actorId, payload, previousHash, createdAt })).digest('hex')
}
function signedMessage(eventHash: string): Buffer {
  return Buffer.from(`edocbr.local-event-signature.v1\n${eventHash}`, 'utf8')
}
function fromRow(row: EventRow, tenantId: string, deviceId: string): LocalJournalEvent {
  return { tenantId, deviceId, sessionId: row.session_id, sequence: row.sequence,
    commandId: row.command_id, eventType: row.event_type, actorId: row.actor_id,
    payload: JSON.parse(row.payload_json) as unknown, previousHash: row.previous_hash,
    eventHash: row.event_hash, signatureBase64: row.signature_base64, createdAt: row.created_at }
}

export function openLocalEventJournal(args: {
  root: string; tenantId: string; deviceId: string; privateKey: KeyObject
}): {
  append(input: { sessionId: string; commandId: string; expectedSequence: number;
    eventType: string; actorId: string; payload: unknown }): LocalJournalEvent
  list(sessionId: string, afterSequence?: number): LocalJournalEvent[]
  verify(): void
  close(): void
} {
  if (!isAbsolute(args.root) || !args.tenantId || !args.deviceId ||
      args.privateKey.type !== 'private' || args.privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Identidade do diário local inválida.')
  }
  const root = lstatSync(args.root)
  if (!root.isDirectory() || root.isSymbolicLink() || (process.platform !== 'win32' && (root.mode & 0o077))) {
    throw new Error('Diretório do diário local inseguro.')
  }
  const path = join(args.root, 'events.sqlite')
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) {
      throw new Error('Arquivo do diário local inseguro.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    closeSync(openSync(path, 'wx', 0o600))
  }
  const db = new Database(path, { create: false, strict: true })
  try {
    const publicKey = createPublicKey(args.privateKey)
    const publicKeySha256 = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' }) as Buffer).digest('hex')
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA synchronous = FULL')
    db.run('PRAGMA busy_timeout = 5000')
    db.run(`CREATE TABLE IF NOT EXISTS journal_scope (
      id INTEGER PRIMARY KEY CHECK (id = 1), tenant_id TEXT NOT NULL,
      device_id TEXT NOT NULL, public_key_sha256 TEXT NOT NULL, format_version INTEGER NOT NULL)`)
    db.run(`CREATE TABLE IF NOT EXISTS local_events (
      session_id TEXT NOT NULL, sequence INTEGER NOT NULL, command_id TEXT NOT NULL,
      event_type TEXT NOT NULL, actor_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL, signature_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (session_id, sequence), UNIQUE (session_id, command_id))`)
    db.run(`CREATE TABLE IF NOT EXISTS session_cursor (
      session_id TEXT PRIMARY KEY, last_sequence INTEGER NOT NULL, last_hash TEXT NOT NULL)`)
    const initialize = db.transaction(() => {
      const scope = db.query('SELECT tenant_id, device_id, public_key_sha256, format_version FROM journal_scope WHERE id = 1').get() as ScopeRow | null
      if (!scope) db.query('INSERT INTO journal_scope (id, tenant_id, device_id, public_key_sha256, format_version) VALUES (1, ?, ?, ?, ?)')
        .run(args.tenantId, args.deviceId, publicKeySha256, FORMAT_VERSION)
      else if (scope.tenant_id !== args.tenantId || scope.device_id !== args.deviceId ||
          scope.public_key_sha256 !== publicKeySha256 || scope.format_version !== FORMAT_VERSION) {
        throw new Error('Diário local pertence a outra Câmara, dispositivo, chave ou versão.')
      }
    })
    initialize.immediate()
    const check = db.query('PRAGMA quick_check').get() as { quick_check: string }
    if (check.quick_check !== 'ok') throw new Error('Banco do diário local falhou na verificação de integridade.')

    function verifySession(sessionId: string): void {
      const rows = db.query('SELECT * FROM local_events WHERE session_id = ? ORDER BY sequence').all(sessionId) as EventRow[]
      const cursor = db.query('SELECT last_sequence, last_hash FROM session_cursor WHERE session_id = ?').get(sessionId) as CursorRow | null
      let sequence = 0
      let previousHash = GENESIS
      for (const row of rows) {
        const event = fromRow(row, args.tenantId, args.deviceId)
        if (event.sequence !== sequence + 1 || event.previousHash !== previousHash ||
            canonical(event.payload) !== row.payload_json ||
            hashEvent(event) !== event.eventHash ||
            !verify(null, signedMessage(event.eventHash), publicKey, Buffer.from(event.signatureBase64, 'base64'))) {
          throw new Error(`Cadeia ou assinatura do diário local inválida na sessão ${sessionId}.`)
        }
        sequence = event.sequence
        previousHash = event.eventHash
      }
      if ((cursor?.last_sequence ?? 0) !== sequence || (cursor?.last_hash ?? GENESIS) !== previousHash) {
        throw new Error(`Cursor do diário local diverge na sessão ${sessionId}.`)
      }
    }

    function verifyAll(): void {
      const sessions = db.query(`SELECT session_id FROM local_events UNION SELECT session_id FROM session_cursor`)
        .all() as Array<{ session_id: string }>
      for (const item of sessions) verifySession(item.session_id)
    }
    verifyAll()

    return {
      append(input) {
        if (!input.sessionId || input.sessionId.length > 200 || !input.commandId || input.commandId.length > 200 ||
            !input.actorId || input.actorId.length > 200 ||
            !/^[a-z][a-z0-9._-]{1,63}$/.test(input.eventType) ||
            !Number.isSafeInteger(input.expectedSequence) || input.expectedSequence < 0) {
          throw new Error('Comando do diário local inválido.')
        }
        const payloadJson = canonical(input.payload)
        if (Buffer.byteLength(payloadJson) > MAX_PAYLOAD_BYTES) throw new Error('Evento local excede o limite de bytes.')
        const write = db.transaction(() => {
          const existing = db.query('SELECT * FROM local_events WHERE session_id = ? AND command_id = ?')
            .get(input.sessionId, input.commandId) as EventRow | null
          if (existing) {
            if (canonical(JSON.parse(existing.payload_json) as unknown) !== existing.payload_json ||
                hashEvent(fromRow(existing, args.tenantId, args.deviceId)) !== existing.event_hash ||
                !verify(null, signedMessage(existing.event_hash), publicKey, Buffer.from(existing.signature_base64, 'base64'))) {
              throw new Error('Evento repetido do diário local falhou na integridade.')
            }
            if (existing.event_type !== input.eventType || existing.actor_id !== input.actorId ||
                existing.payload_json !== payloadJson) throw new Error('commandId reutilizado com outro ato.')
            return fromRow(existing, args.tenantId, args.deviceId)
          }
          const cursor = db.query('SELECT last_sequence, last_hash FROM session_cursor WHERE session_id = ?')
            .get(input.sessionId) as CursorRow | null
          if (cursor) {
            const last = db.query('SELECT * FROM local_events WHERE session_id = ? AND sequence = ?')
              .get(input.sessionId, cursor.last_sequence) as EventRow | null
            if (!last || last.event_hash !== cursor.last_hash ||
                canonical(JSON.parse(last.payload_json) as unknown) !== last.payload_json ||
                hashEvent(fromRow(last, args.tenantId, args.deviceId)) !== last.event_hash ||
                !verify(null, signedMessage(last.event_hash), publicKey, Buffer.from(last.signature_base64, 'base64'))) {
              throw new Error('Último evento do diário local diverge do cursor ou assinatura.')
            }
          }
          const sequence = cursor?.last_sequence ?? 0
          if (sequence !== input.expectedSequence) throw new Error('Sequência esperada diverge do diário local.')
          const unsigned = { tenantId: args.tenantId, deviceId: args.deviceId,
            sessionId: input.sessionId, sequence: sequence + 1, commandId: input.commandId,
            eventType: input.eventType, actorId: input.actorId, payload: JSON.parse(payloadJson) as unknown,
            previousHash: cursor?.last_hash ?? GENESIS, createdAt: new Date().toISOString() }
          const eventHash = hashEvent(unsigned)
          const signatureBase64 = sign(null, signedMessage(eventHash), args.privateKey).toString('base64')
          db.query(`INSERT INTO local_events (session_id, sequence, command_id, event_type, actor_id,
            payload_json, previous_hash, event_hash, signature_base64, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.sessionId, sequence + 1,
            input.commandId, input.eventType, input.actorId, payloadJson, unsigned.previousHash,
            eventHash, signatureBase64, unsigned.createdAt)
          db.query(`INSERT INTO session_cursor (session_id, last_sequence, last_hash) VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET last_sequence = excluded.last_sequence,
              last_hash = excluded.last_hash`).run(input.sessionId, sequence + 1, eventHash)
          return { ...unsigned, eventHash, signatureBase64 }
        })
        return write.immediate() as LocalJournalEvent
      },
      list(sessionId, afterSequence = 0) {
        if (!sessionId || !Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Consulta do diário local inválida.')
        verifySession(sessionId)
        return (db.query('SELECT * FROM local_events WHERE session_id = ? AND sequence > ? ORDER BY sequence')
          .all(sessionId, afterSequence) as EventRow[]).map((row) => fromRow(row, args.tenantId, args.deviceId))
      },
      verify: verifyAll,
      close: () => db.close(),
    }
  } catch (error) { db.close(); throw error }
}
