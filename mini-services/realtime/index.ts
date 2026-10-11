/**
 * Legis SaaS — mini-serviço de TEMPO REAL (Task 2-b)
 * --------------------------------------------------
 * Publica eventos da tabela OutboxEvent (padrão outbox transacional, ADR-003)
 * para clientes socket.io:
 *   - escopo interno  → sala `tenant:{tenantId}`  (backoffice, payload completo)
 *   - escopo público  → sala `public:{tenantId}`  (portal/telão, payload sanitizado)
 *
 * Envelope emitido: RealtimeEvent (docs/api-contract.md → "Eventos outbox"):
 *   { eventId, eventType, schemaVersion, tenantId, sessionId?, aggregateId,
 *     aggregateVersion, occurredAt, origin, correlationId, payload }
 * Os campos auxiliares `origin`/`aggregateVersion`/`correlationId` são "erguidos"
 * do payload para o envelope e REMOVIDOS da cópia emitida em `payload`.
 *
 * SQLite: somente leitura, com checkpoint de rowid em arquivo para não causar
 * SQLITE_BUSY nas transações da API. PostgreSQL: eventos pendentes são marcados
 * como publicados depois da emissão; execute um publicador por banco.
 *
 * Porta fixa 3003 · path '/' OBRIGATÓRIO (gateway Caddy) · poller 500ms.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Server, type Socket } from 'socket.io'
import { Database } from 'bun:sqlite'
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { realtimeSecret, verifyRealtimeGrant } from '../../src/lib/realtime-auth'
import { publishPostgresOutboxBatch } from './postgres-outbox'

// ─── Configuração ───────────────────────────────────────────────────────────

const PORT = 3003
const DB_PATH = process.env.REALTIME_DB_PATH?.trim() || resolve(import.meta.dir, '../../db/custom.db')
if (process.env.REALTIME_DATABASE_PROVIDER && process.env.REALTIME_DATABASE_PROVIDER !== 'postgresql') {
  throw new Error('REALTIME_DATABASE_PROVIDER deve ser postgresql ou vazio (SQLite)')
}
const USE_POSTGRES = process.env.REALTIME_DATABASE_PROVIDER === 'postgresql'
if (USE_POSTGRES && !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('REALTIME_DATABASE_PROVIDER=postgresql exige DATABASE_URL PostgreSQL')
}
const CHECKPOINT_PATH = import.meta.dir + '/checkpoint.json'
const POLL_INTERVAL_MS = 500
const POLL_BATCH_LIMIT = 50

/** TenantIds são cuids gerados pelo Prisma (ex.: cmtfsplwd0000m6aq249j4ciq). */
const CUID_RE = /^c[A-Za-z0-9]{20,40}$/
const AUTH_SECRET = realtimeSecret()

type Scope = 'internal' | 'public'

// ─── Logging conciso em JSON (sem dados sensíveis) ──────────────────────────

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }))
}

// ─── Banco de dados ───────────────────────────────────────────────────────────

const db = USE_POSTGRES ? null : new Database(DB_PATH, { readonly: true, strict: true })
const pgDb = USE_POSTGRES ? new PrismaClient() : null

interface OutboxRow {
  rowid?: number
  id: string
  tenantId: string
  eventType: string
  aggregateId: string
  sessionId: string | null
  internalPayload: string
  publicPayload: string | null
  status: string
  /** Integer epoch millis (gravação via Prisma) ou string SQLite ("YYYY-MM-DD HH:MM:SS"). */
  createdAt: number | string | Date
  publishedAt: number | string | Date | null
}

const selectAfterStmt = db?.prepare(
  'SELECT rowid, * FROM OutboxEvent WHERE rowid > ? ORDER BY rowid ASC LIMIT ?',
)
const maxRowidStmt = db?.prepare('SELECT COALESCE(MAX(rowid), 0) AS maxRowid FROM OutboxEvent')

// ─── Checkpoint (avanço por rowid, persistido em arquivo próprio) ────────────────

function loadCheckpoint(): number | null {
  try {
    const json = readFileSync(CHECKPOINT_PATH, 'utf8')
    const parsed = JSON.parse(json) as { lastRowid?: number }
    return typeof parsed.lastRowid === 'number' ? parsed.lastRowid : null
  } catch {
    return null
  }
}

function saveCheckpoint(lastRowid: number): void {
  try {
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({ lastRowid, at: new Date().toISOString() }),
    )
  } catch {
    /* checkpoint é best-effort; a memória mantém o valor da sessão */
  }
}

// Primeira execução (sem checkpoint): começa do fim da fila — eventos antigos
// são reconstruídos pelos clientes via snapshot (public/live + queries).
let checkpoint: number =
  USE_POSTGRES ? 0 : loadCheckpoint() ?? (maxRowidStmt!.get() as { maxRowid: number }).maxRowid

// ─── Conversão de datas → ISO 8601 ──────────────────────────────────────────

/**
 * `createdAt` pode chegar como epoch millis (Prisma grava INTEGER) ou como texto
 * "YYYY-MM-DD HH:MM:SS[.SSS]" (CURRENT_TIMESTAMP do SQLite) — ambos em UTC.
 */
function toIsoDate(value: number | string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const t = value.trim()
    if (/^-?\d+$/.test(t)) return new Date(Number(t)).toISOString()
    if (t.includes('T')) {
      // já é ISO; garante sufixo de timezone quando ausente
      return /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`
    }
    // formato do SQLite datetime(): espaço → 'T', trata-se como UTC
    return `${t.replace(' ', 'T')}Z`
  }
  return new Date().toISOString()
}

// ─── Envelope RealtimeEvent ─────────────────────────────────────────────────

interface RealtimeEnvelope {
  eventId: string
  eventType: string
  schemaVersion: number
  tenantId: string
  sessionId?: string
  aggregateId: string
  aggregateVersion: number
  occurredAt: string
  origin: string
  correlationId: string
  payload: Record<string, unknown>
}

const AUX_FIELDS = ['origin', 'aggregateVersion', 'correlationId'] as const

/**
 * Monta o envelope a partir de uma linha do outbox e do payload (JSON) do
 * respectivo escopo. Campos auxiliares são erguidos para o envelope e
 * removidos da cópia emitida em `payload`. Retorna null quando não há payload.
 */
function buildEnvelope(row: OutboxRow, payloadJson: string | null): RealtimeEnvelope | null {
  if (!payloadJson) return null

  let parsed: Record<string, unknown>
  try {
    const raw: unknown = JSON.parse(payloadJson)
    parsed = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  } catch {
    parsed = {}
  }

  const { origin, aggregateVersion, correlationId, ...payload } = parsed

  return {
    eventId: row.id,
    eventType: row.eventType,
    schemaVersion: 1,
    tenantId: row.tenantId,
    sessionId: row.sessionId ?? undefined,
    aggregateId: row.aggregateId,
    aggregateVersion: typeof aggregateVersion === 'number' ? aggregateVersion : 1,
    occurredAt: toIsoDate(row.createdAt),
    origin: typeof origin === 'string' ? origin : 'cloud',
    correlationId: typeof correlationId === 'string' ? correlationId : row.id,
    payload,
  }
}

// ─── Servidor HTTP + socket.io ──────────────────────────────────────────────

const httpServer = createServer()

const io = new Server(httpServer, {
  // NÃO mudar o path — o gateway Caddy depende dele para rotear /?XTransformPort=3003
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

/**
 * Health check HTTP (`GET /health` → 200 {"ok":true}).
 *
 * Com `path: '/'` o engine.io intercepta TODAS as requisições HTTP
 * (`check: '/' === req.url.slice(0, 1)`), inclusive `/health` — por isso o
 * handler precisa rodar NA FRENTE do listener do engine.io: guardamos os
 * listeners de request atuais (os do engine.io), registramos o nosso no lugar
 * e repassamos para eles tudo que não for /health.
 */
const engineRequestListeners = httpServer.listeners('request').slice(0)
if (engineRequestListeners.length === 0) {
  log('warn', 'nenhum listener de request encontrado no engine.io (inesperado)')
}
httpServer.removeAllListeners('request')
httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
  const pathname = (req.url ?? '').split('?')[0] ?? '/'
  if (pathname === '/health' || pathname.startsWith('/health/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        service: 'legis-realtime',
        port: PORT,
        uptimeSeconds: Math.round(process.uptime()),
      }),
    )
    return
  }
  for (const listener of engineRequestListeners) {
    listener.call(httpServer, req, res)
  }
})

// ─── Handshake / subscribe ──────────────────────────────────────────────────

function applySubscribe(
  socket: Socket,
  rawTenantId: unknown,
  rawScope: unknown,
  rawToken: unknown,
  source: 'handshake-auth' | 'subscribe',
): void {
  const tenantId = typeof rawTenantId === 'string' ? rawTenantId.trim() : ''
  const scope: Scope | null =
    rawScope === 'internal' ? 'internal' : rawScope === 'public' ? 'public' : null

  if (!CUID_RE.test(tenantId) || scope === null) {
    socket.emit('subscribe_error', {
      error: 'Assinatura inválida: envie { tenantId (cuid), scope: "internal" | "public" }',
    })
    log('warn', 'subscribe rejeitado', { socketId: socket.id, source })
    return
  }

  if (scope === 'internal') {
    const grant = AUTH_SECRET ? verifyRealtimeGrant(rawToken, AUTH_SECRET) : null
    if (!grant || grant.tenantId !== tenantId) {
      socket.emit('subscribe_error', { error: 'Acesso interno não autorizado.' })
      log('warn', 'subscribe interno rejeitado', { socketId: socket.id, source })
      return
    }
    const previousTimer = authTimers.get(socket)
    if (previousTimer) clearTimeout(previousTimer)
    const expiresInMs = Math.max(1, grant.exp * 1000 - Date.now())
    authTimers.set(socket, setTimeout(() => socket.disconnect(true), expiresInMs))
  }

  const room = scope === 'internal' ? `tenant:${tenantId}` : `public:${tenantId}`
  socket.join(room)
  socket.data.tenantId = tenantId
  socket.data.scope = scope
  socket.emit('subscribed', { tenantId, scope, rooms: [room] })
  log('info', 'cliente inscrito', { socketId: socket.id, tenantId, scope, room, source })
}

const authTimers = new WeakMap<Socket, ReturnType<typeof setTimeout>>()

io.on('connection', (socket) => {
  log('info', 'cliente conectado', {
    socketId: socket.id,
    transport: socket.conn.transport.name,
  })

  // Fallback: o hook do frontend envia auth {tenantId, scope} no handshake
  // E emite `subscribe` logo após conectar — aceitamos ambos (join é idempotente).
  const auth = socket.handshake.auth as { tenantId?: unknown; scope?: unknown; token?: unknown } | undefined
  if (auth && typeof auth === 'object') {
    applySubscribe(socket, auth.tenantId, auth.scope, auth.token, 'handshake-auth')
  }

  socket.on('subscribe', (data: unknown) => {
    const d = (data ?? {}) as { tenantId?: unknown; scope?: unknown; token?: unknown }
    applySubscribe(socket, d?.tenantId, d?.scope, d?.token, 'subscribe')
  })

  socket.on('disconnect', (reason) => {
    const timer = authTimers.get(socket)
    if (timer) clearTimeout(timer)
    authTimers.delete(socket)
    log('info', 'cliente desconectado', {
      socketId: socket.id,
      reason,
      tenantId: socket.data.tenantId ?? null,
      scope: socket.data.scope ?? null,
    })
  })
})

// ─── Poller do outbox (500ms) ───────────────────────────────────────────────

function roomHasClients(room: string): boolean {
  return io.sockets.adapter.rooms.has(room)
}

/** Publica um lote; SQLite usa checkpoint, PostgreSQL usa status pendente. */
async function publishPendingBatch(): Promise<void> {
  if (pgDb) {
    try {
      const rows = await publishPostgresOutboxBatch(pgDb, (row) => emitOutboxRow(row), POLL_BATCH_LIMIT)
      if (rows.length > 0) logBatch(rows)
    } catch (err) {
      log('error', 'falha ao publicar outbox PostgreSQL; evento permanece pendente', { error: String(err) })
    }
    return
  }
  let rows: OutboxRow[] = []
  try {
    rows = selectAfterStmt!.all(checkpoint, POLL_BATCH_LIMIT) as OutboxRow[]
  } catch (err) {
    log('error', 'falha ao selecionar eventos do outbox', { error: String(err) })
    return
  }

  let last = checkpoint
  for (const row of rows) {
    try {
      emitOutboxRow(row)
    } catch (err) {
      log('error', 'falha ao emitir evento', {
        eventId: row.id,
        eventType: row.eventType,
        error: String(err),
      })
    }
    last = row.rowid!
  }

  if (rows.length > 0) {
    checkpoint = last
    saveCheckpoint(checkpoint)
    logBatch(rows)
  }
}

function emitOutboxRow(row: OutboxRow): void {
  const internalEnvelope = buildEnvelope(row, row.internalPayload)
  if (internalEnvelope !== null) io.to(`tenant:${row.tenantId}`).emit(row.eventType, internalEnvelope)
  const publicEnvelope = buildEnvelope(row, row.publicPayload)
  if (publicEnvelope !== null) io.to(`public:${row.tenantId}`).emit(row.eventType, publicEnvelope)
}

function logBatch(rows: OutboxRow[]): void {
  log('info', 'lote do outbox publicado', {
    batch: rows.length,
    ...(USE_POSTGRES ? {} : { checkpoint }),
    eventTypes: [...new Set(rows.map((r) => r.eventType))],
    tenants: [...new Set(rows.map((r) => r.tenantId))],
    internalRoomsOccupied: rows.some((r) => roomHasClients(`tenant:${r.tenantId}`)),
    publicRoomsOccupied: rows.some((r) => roomHasClients(`public:${r.tenantId}`)),
  })
}

let polling = true

async function pollLoop(): Promise<void> {
  while (polling) {
    await publishPendingBatch()
    await Bun.sleep(POLL_INTERVAL_MS)
  }
}

// ─── Início + graceful shutdown ─────────────────────────────────────────────

httpServer.listen(PORT, () => {
  log('info', 'serviço de tempo real iniciado', {
    port: PORT,
    provider: USE_POSTGRES ? 'postgresql' : 'sqlite',
    ...(USE_POSTGRES ? {} : { dbPath: DB_PATH }),
    pollIntervalMs: POLL_INTERVAL_MS,
    batchLimit: POLL_BATCH_LIMIT,
  })
})

void pollLoop()

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  polling = false
  log('info', 'desligando serviço de tempo real', { signal })

  try {
    // io.close() também encerra o servidor HTTP anexado
    await new Promise<void>((resolve) => {
      io.close(() => resolve())
      setTimeout(resolve, 3000).unref?.()
    })
  } catch (err) {
    log('error', 'erro ao encerrar socket.io', { error: String(err) })
  }

  try {
    db?.close()
    await pgDb?.$disconnect()
  } catch {
    /* banco já fechado */
  }

  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
