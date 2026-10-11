/**
 * Teste ponta a ponta do serviço de tempo real (Task 2-b).
 *
 * Fluxo:
 *  1. Conecta cliente INTERNAL em http://localhost:3003 com auth {tenantId, scope:'internal'}
 *     (tenantId real, lido do banco) e emite `subscribe`, aguardando confirmação `subscribed`.
 *  2. (Bônus) Conecta também um cliente PUBLIC para validar o payload sanitizado.
 *  3. Insere um OutboxEvent 'test.ping' com status 'pending' direto no SQLite.
 *  4. Aguarda receber 'test.ping' nos clientes e valida o envelope:
 *     origin/aggregateVersion/correlationId "erguidos" e REMOVIDOS do payload.
 *  5. Confere no banco que o evento virou 'published' (com publishedAt).
 *  6. Remove o evento de teste e termina: exit 0 (sucesso) / 1 (falha).
 *
 * Uso: bun test-client.ts
 */

import { io, type Socket } from 'socket.io-client'
import { Database } from 'bun:sqlite'

const URL = 'http://localhost:3003'
const DB_PATH = '/home/z/my-project/db/custom.db'
const GLOBAL_TIMEOUT_MS = 20000
const DB_POLL_TIMEOUT_MS = 5000

// ─── Helpers ────────────────────────────────────────────────────────────────

const failures: string[] = []

function check(cond: unknown, msg: string): boolean {
  const ok = Boolean(cond)
  console.log(`  ${ok ? '✔' : '✘'} ${msg}`)
  if (!ok) failures.push(msg)
  return ok
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`tempo esgotado aguardando: ${label}`)), ms),
    ),
  ])
}

function onceEvent(socket: Socket, event: string, ms = 8000): Promise<any> {
  return withTimeout(
    new Promise((resolve) => socket.once(event, (payload: any) => resolve(payload))),
    ms,
    `evento '${event}'`,
  )
}

/** Aguarda conexão — resolve imediatamente se o socket já conectou (evita race com o connect disparado antes do listener). */
function waitConnected(socket: Socket, label: string, ms = 8000): Promise<void> {
  if (socket.connected) return Promise.resolve()
  return withTimeout(
    new Promise<void>((resolve) => socket.once('connect', () => resolve())),
    ms,
    `conexão ${label}`,
  )
}

// ─── Timeout global de segurança ────────────────────────────────────────────

const globalTimer = setTimeout(() => {
  console.error('✘ TIMEOUT GLOBAL — teste abortado')
  process.exit(1)
}, GLOBAL_TIMEOUT_MS)
globalTimer.unref?.()

// ─── Banco ──────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH, { strict: true })
db.exec('PRAGMA busy_timeout = 2000;')

const tenant = db.prepare('SELECT id, slug, name FROM Tenant LIMIT 1').get() as
  | { id: string; slug: string; name: string }
  | null

if (!tenant) {
  console.error('✘ Nenhum tenant encontrado no banco — rode o seed antes.')
  process.exit(1)
}

// Limpa resíduos de execuções anteriores
db.prepare("DELETE FROM OutboxEvent WHERE eventType = 'test.ping'").run()

// ─── Clientes socket.io ─────────────────────────────────────────────────────

console.log(`▸ Conectando em ${URL} (tenant: ${tenant.slug} / ${tenant.id})`)

const internal = io(URL, {
  transports: ['websocket', 'polling'],
  auth: { tenantId: tenant.id, scope: 'internal' },
  reconnection: false,
  timeout: 8000,
})

const publicClient = io(URL, {
  transports: ['websocket', 'polling'],
  auth: { tenantId: tenant.id, scope: 'public' },
  reconnection: false,
  timeout: 8000,
})

async function main(): Promise<void> {
  // 1) Handshake + subscribe do cliente interno
  await waitConnected(internal, 'interna')
  console.log('▸ Cliente interno conectado, emitindo subscribe…')
  internal.emit('subscribe', { tenantId: tenant.id, scope: 'internal' })
  const subscribed = await onceEvent(internal, 'subscribed')
  check(subscribed?.tenantId === tenant.id, `confirmado 'subscribed' (tenantId=${subscribed?.tenantId})`)
  check(subscribed?.scope === 'internal', 'confirmado scope=internal')
  check(
    Array.isArray(subscribed?.rooms) && subscribed.rooms[0] === `tenant:${tenant.id}`,
    `confirmada sala tenant:${tenant.id}`,
  )

  // 2) (Bônus) cliente público
  await waitConnected(publicClient, 'pública')
  publicClient.emit('subscribe', { tenantId: tenant.id, scope: 'public' })
  const publicSubscribed = await onceEvent(publicClient, 'subscribed')
  check(publicSubscribed?.rooms?.[0] === `public:${tenant.id}`, `confirmada sala public:${tenant.id}`)

  // 3) Insere evento de teste no outbox
  const eventId = crypto.randomUUID()
  const aggregateId = `test:${eventId}`
  const internalPayload = { origin: 'cloud', aggregateVersion: 1, correlationId: 'test', hello: 'mundo' }
  const publicPayload = { origin: 'cloud', hello: 'publico' }

  db.prepare(
    `INSERT INTO OutboxEvent (id, tenantId, eventType, aggregateId, sessionId, internalPayload, publicPayload, status, createdAt)
     VALUES (?, ?, 'test.ping', ?, NULL, ?, ?, 'pending', datetime('now'))`,
  ).run(eventId, tenant.id, aggregateId, JSON.stringify(internalPayload), JSON.stringify(publicPayload))
  console.log(`▸ Evento inserido no outbox (id=${eventId}, status=pending) — aguardando publicação…`)

  // 4) Recebe e valida o envelope interno
  const envelope: any = await onceEvent(internal, 'test.ping', 10000)
  console.log('▸ Envelope interno recebido:')
  console.log(JSON.stringify(envelope, null, 2))

  check(envelope.eventId === eventId, 'eventId confere com o id inserido')
  check(envelope.eventType === 'test.ping', 'eventType = test.ping')
  check(envelope.schemaVersion === 1, 'schemaVersion = 1')
  check(envelope.tenantId === tenant.id, 'tenantId confere')
  check(envelope.sessionId === undefined, 'sessionId ausente (coluna NULL → undefined)')
  check(envelope.aggregateId === aggregateId, 'aggregateId confere')
  check(envelope.aggregateVersion === 1, 'aggregateVersion erguido do payload = 1')
  check(typeof envelope.occurredAt === 'string' && /\d{4}-\d{2}-\d{2}T/.test(envelope.occurredAt), `occurredAt é ISO string (${envelope.occurredAt})`)
  check(envelope.origin === 'cloud', "origin erguido do payload = 'cloud'")
  check(envelope.correlationId === 'test', "correlationId erguido do payload = 'test'")
  check(envelope.payload?.hello === 'mundo', "payload.hello = 'mundo'")
  check(!('origin' in (envelope.payload ?? {})), 'payload SEM origin (removido após erguer)')
  check(!('aggregateVersion' in (envelope.payload ?? {})), 'payload SEM aggregateVersion (removido após erguer)')
  check(!('correlationId' in (envelope.payload ?? {})), 'payload SEM correlationId (removido após erguer)')

  // 5) (Bônus) recebe e valida o envelope público (sanitizado)
  const publicEnvelope: any = await onceEvent(publicClient, 'test.ping', 5000)
  console.log('▸ Envelope público recebido:')
  console.log(JSON.stringify(publicEnvelope, null, 2))

  check(publicEnvelope.eventId === eventId, 'público: eventId confere')
  check(publicEnvelope.origin === 'cloud', "público: origin erguido = 'cloud'")
  check(publicEnvelope.correlationId === eventId, 'público: correlationId default = eventId (payload público não tinha)')
  check(publicEnvelope.payload?.hello === 'publico', "público: payload.hello = 'publico' (payload sanitizado)")
  check(!('origin' in (publicEnvelope.payload ?? {})), 'público: payload SEM origin')
  check(!('hello' in (publicEnvelope.payload ?? {}) && publicEnvelope.payload.hello === 'mundo'), 'público: NÃO recebeu payload interno')

  // 6) Confere no banco que virou published
  let row: any = null
  const started = Date.now()
  while (Date.now() - started < DB_POLL_TIMEOUT_MS) {
    row = db.prepare('SELECT status, publishedAt FROM OutboxEvent WHERE id = ?').get(eventId)
    if (row?.status === 'published') break
    await Bun.sleep(100)
  }
  check(row?.status === 'published', "evento marcado como 'published' no banco")
  check(Boolean(row?.publishedAt), `publishedAt preenchido (${row?.publishedAt ?? 'null'})`)

  // 7) Limpeza
  db.prepare("DELETE FROM OutboxEvent WHERE eventType = 'test.ping'").run()
  console.log('▸ Evento de teste removido do banco (limpeza concluída)')
}

main()
  .then(() => {
    internal.close()
    publicClient.close()
    db.close()
    clearTimeout(globalTimer)
    if (failures.length > 0) {
      console.error(`\n✘ TESTE FALHOU — ${failures.length} verificação(ões) incorreta(s):`)
      for (const f of failures) console.error(`  - ${f}`)
      process.exit(1)
    }
    console.log('\n✔ TESTE PONTA A PONTA PASSOU')
    process.exit(0)
  })
  .catch((err) => {
    console.error(`\n✘ ERRO NO TESTE: ${err instanceof Error ? err.message : String(err)}`)
    internal.close()
    publicClient.close()
    try { db.close() } catch { /* ignore */ }
    process.exit(1)
  })
