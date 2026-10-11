/**
 * Legis SaaS — mini-serviço de WEBHOOKS (Fase 6, Task 7)
 * ------------------------------------------------------
 * Poller (1s) da tabela `WebhookDelivery`:
 *   - lote de 10 entregas `pending` vencidas (mais antigas primeiro);
 *   - POST HTTP com assinatura HMAC-SHA256 do corpo:
 *       x-legis-signature: sha256=<hex>
 *       x-legis-timestamp: <epoch-seconds>
 *       x-legis-event:    <eventType>
 *     Content-Type: application/json · timeout 10s (AbortController);
 *   - 2xx → success (deliveredAt);
 *   - falha → attempts+1; attempts >= 5 → dead (dead-letter) com notificação
 *     interna para o tenant_admin (Notification + OutboxEvent notification.new);
 *     senão backoff [5s, 30s, 120s, 600s][attempts-1] (índice clamp);
 *   - persiste lastError (primeiros 300 chars) e responseStatus.
 *
 * SQLite: PRAGMA busy_timeout=5000 + journal_mode=WAL, datas epoch millis.
 * PostgreSQL: acesso Prisma; dead-letter, notificação e outbox atômicos.
 *
 * Porta fixa 3004 · health check GET /health · logging JSON conciso ·
 * graceful shutdown SIGTERM/SIGINT.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Database, type Statement, type SQLQueryBindings } from 'bun:sqlite'
import { PrismaClient } from '@prisma/client'
import { resolve } from 'path'
import { processPostgresWebhookBatch } from './postgres-delivery'
import { deliverWebhook } from './http-delivery'

// ─── Configuração ───────────────────────────────────────────────────────────

const PORT = 3004
const DB_PATH = process.env.WEBHOOKS_DB_PATH?.trim() || resolve(import.meta.dir, '../../db/custom.db')
if (process.env.WEBHOOKS_DATABASE_PROVIDER && process.env.WEBHOOKS_DATABASE_PROVIDER !== 'postgresql') {
  throw new Error('WEBHOOKS_DATABASE_PROVIDER deve ser postgresql ou vazio (SQLite)')
}
const USE_POSTGRES = process.env.WEBHOOKS_DATABASE_PROVIDER === 'postgresql'
if (USE_POSTGRES && !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('WEBHOOKS_DATABASE_PROVIDER=postgresql exige DATABASE_URL PostgreSQL')
}
const POLL_INTERVAL_MS = 1000
const BATCH_LIMIT = 10
const MAX_ATTEMPTS = 5
const BACKOFF_SECONDS = [5, 30, 120, 600] // índice attempts-1 (clamp)

// ─── Logging conciso em JSON ────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }))
}

// ─── Banco de dados ───────────────────────────────────────────────────────────

const db = USE_POSTGRES ? null : new Database(DB_PATH, { strict: true })
const pgDb = USE_POSTGRES ? new PrismaClient() : null
db?.exec('PRAGMA journal_mode=WAL')
db?.exec('PRAGMA busy_timeout=5000')

interface DeliveryRow {
  id: string
  endpointId: string
  eventType: string
  payload: string
  status: string
  attempts: number
  nextAttemptAt: number | string | null
  createdAt: number | string
}

interface EndpointRow {
  id: string
  tenantId: string
  url: string
  secret: string
  active: number
}

const selectDueStmt = db?.prepare(`
  SELECT id, endpointId, eventType, payload, status, attempts, nextAttemptAt, createdAt
  FROM WebhookDelivery
  WHERE status = 'pending' AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
  ORDER BY createdAt ASC
  LIMIT ?
`)

const selectEndpointStmt = db?.prepare('SELECT id, tenantId, url, secret, active FROM WebhookEndpoint WHERE id = ?')

/** Executa uma escrita com retry em SQLITE_BUSY (até 3x / 150ms de espera). */
function runWrite(stmt: Statement, ...params: SQLQueryBindings[]): void {
  for (let attempt = 1; ; attempt++) {
    try {
      stmt.run(...params)
      return
    } catch (err) {
      const msg = String(err)
      if (msg.includes('SQLITE_BUSY') && attempt < 3) {
        const ms = 150 * attempt
        void Bun.sleep(ms)
        continue
      }
      throw err
    }
  }
}

const markSuccessStmt = db?.prepare(
  "UPDATE WebhookDelivery SET status = 'success', deliveredAt = ?, attempts = attempts + 1, lastError = NULL, responseStatus = ?, nextAttemptAt = NULL WHERE id = ?"
)
const markRetryStmt = db?.prepare(
  'UPDATE WebhookDelivery SET attempts = ?, lastError = ?, responseStatus = ?, nextAttemptAt = ? WHERE id = ?'
)
const markDeadStmt = db?.prepare(
  "UPDATE WebhookDelivery SET status = 'dead', attempts = ?, lastError = ?, responseStatus = ?, nextAttemptAt = NULL WHERE id = ?"
)
const deferStmt = db?.prepare('UPDATE WebhookDelivery SET nextAttemptAt = ? WHERE id = ?')

const insertNotificationStmt = db?.prepare(
  'INSERT INTO Notification (id, tenantId, title, body, kind, module, targetRole, readAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)'
)
const insertOutboxStmt = db?.prepare(
  "INSERT INTO OutboxEvent (id, tenantId, eventType, aggregateId, sessionId, internalPayload, publicPayload, status, createdAt, publishedAt) VALUES (?, ?, 'notification.new', ?, NULL, ?, NULL, 'pending', ?, NULL)"
)

// ─── Cuid-like id (compatível com formato Prisma) ───────────────────────────

function cuidLike(): string {
  const t = Date.now().toString(36).padStart(8, '0')
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  return `cm${t}${rand}`.slice(0, 25)
}

/** Entrega em dead-letter → notifica o tenant_admin (Notification + outbox). */
function notifyDeadLetter(endpoint: EndpointRow, delivery: DeliveryRow, reason: string): void {
  const now = Date.now()
  const notificationId = cuidLike()
  const title = 'Webhook em dead-letter'
  const body = `A entrega do evento "${delivery.eventType}" para ${endpoint.url} falhou após ${MAX_ATTEMPTS} tentativas e foi movida para dead-letter. Reprocesse pelo módulo Webhooks. Último erro: ${reason.slice(0, 160)}`
  const internalPayload = JSON.stringify({
    notificationId,
    title,
    body,
    kind: 'webhook',
    module: 'webhooks',
    targetRole: 'tenant_admin',
    createdAt: new Date(now).toISOString(),
    origin: 'cloud',
    aggregateVersion: 1,
    correlationId: notificationId,
  })
  runWrite(insertNotificationStmt!, notificationId, endpoint.tenantId, title, body, 'webhook', 'webhooks', 'tenant_admin', now)
  runWrite(insertOutboxStmt!, cuidLike(), endpoint.tenantId, notificationId, internalPayload, now)
}

// ─── Poller ─────────────────────────────────────────────────────────────────

let polling = true
let inFlight = 0

async function processDelivery(delivery: DeliveryRow): Promise<void> {
  const endpoint = selectEndpointStmt!.get(delivery.endpointId) as EndpointRow | null
  if (!endpoint) {
    // Endpoint excluído (cascade deveria ter removido; segurança extra)
    runWrite(markDeadStmt!, delivery.attempts + 1, 'Endpoint excluído', null, delivery.id)
    log('warn', 'entrega de endpoint inexistente marcada como dead', { deliveryId: delivery.id })
    return
  }
  if (!endpoint.active) {
    // Endpoint desativado: adia a entrega em 60s (não marca falha)
    runWrite(deferStmt!, Date.now() + 60_000, delivery.id)
    return
  }

  const outcome = await deliverWebhook(endpoint.url, endpoint.secret, delivery.eventType, delivery.payload, delivery.id)
  const now = Date.now()
  const attempts = delivery.attempts + 1

  if (outcome.kind === 'success') {
    runWrite(markSuccessStmt!, now, outcome.responseStatus, delivery.id)
    log('info', 'webhook entregue', {
      deliveryId: delivery.id,
      eventType: delivery.eventType,
      url: endpoint.url,
      responseStatus: outcome.responseStatus,
      attempts,
    })
    return
  }

  const reason = outcome.error.slice(0, 300)
  if (attempts >= MAX_ATTEMPTS) {
    runWrite(markDeadStmt!, attempts, reason, outcome.responseStatus, delivery.id)
    log('error', 'webhook em dead-letter', {
      deliveryId: delivery.id,
      eventType: delivery.eventType,
      url: endpoint.url,
      attempts,
      error: reason,
    })
    try {
      notifyDeadLetter(endpoint, delivery, reason)
    } catch (err) {
      log('error', 'falha ao notificar dead-letter', { deliveryId: delivery.id, error: String(err) })
    }
    return
  }

  const backoffIndex = Math.min(Math.max(attempts - 1, 0), BACKOFF_SECONDS.length - 1)
  const nextAttemptAt = now + BACKOFF_SECONDS[backoffIndex] * 1000
  runWrite(markRetryStmt!, attempts, reason, outcome.responseStatus, nextAttemptAt, delivery.id)
  log('warn', 'falha na entrega — reagendada', {
    deliveryId: delivery.id,
    eventType: delivery.eventType,
    url: endpoint.url,
    attempts,
    responseStatus: outcome.responseStatus,
    nextAttemptIn: BACKOFF_SECONDS[backoffIndex],
    error: reason,
  })
}

async function pollBatch(): Promise<number> {
  if (pgDb) return processPostgresWebhookBatch(pgDb, (endpoint, row) =>
    deliverWebhook(endpoint.url, endpoint.secret, row.eventType, row.payload, row.id), new Date(), BATCH_LIMIT)
  const now = Date.now()
  const rows = selectDueStmt!.all(now, BATCH_LIMIT) as DeliveryRow[]
  for (const row of rows) {
    try {
      await processDelivery(row)
    } catch (err) {
      log('error', 'erro ao processar entrega', { deliveryId: row.id, error: String(err) })
    }
  }
  return rows.length
}

async function pollLoop(): Promise<void> {
  while (polling) {
    try {
      const n = await pollBatch()
      if (n > 0) log('info', 'lote processado', { batch: n })
    } catch (err) {
      log('error', 'falha no ciclo de polling', { error: String(err) })
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }
}

// ─── Servidor HTTP (health check) ───────────────────────────────────────────

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const pathname = (req.url ?? '').split('?')[0] ?? '/'
  if (req.method === 'GET' && (pathname === '/health' || pathname.startsWith('/health/'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        service: 'legis-webhooks',
        port: PORT,
        uptimeSeconds: Math.round(process.uptime()),
        inFlight,
      })
    )
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
})

// ─── Início + graceful shutdown ─────────────────────────────────────────────

httpServer.listen(PORT, () => {
  log('info', 'serviço de webhooks iniciado', {
    port: PORT,
    provider: USE_POSTGRES ? 'postgresql' : 'sqlite',
    ...(USE_POSTGRES ? {} : { dbPath: DB_PATH }),
    pollIntervalMs: POLL_INTERVAL_MS,
    batchLimit: BATCH_LIMIT,
    httpTimeoutMs: 10_000,
    maxAttempts: MAX_ATTEMPTS,
  })
})

void pollLoop()

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  polling = false
  log('info', 'desligando serviço de webhooks', { signal, inFlight })
  try {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
      setTimeout(resolve, 3000).unref?.()
    })
  } catch (err) {
    log('error', 'erro ao encerrar servidor http', { error: String(err) })
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
