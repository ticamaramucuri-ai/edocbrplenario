/** Prove two Socket.IO nodes receive one synthetic PostgreSQL outbox event. */
import { randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { io, type Socket } from 'socket.io-client'
import { issueRealtimeGrant } from '../src/lib/realtime-auth'

const root = new URL('..', import.meta.url).pathname
const config = `${root}/deploy/staging/.env`
const composeFile = `${root}/deploy/staging/compose.yaml`
const values = Object.fromEntries(readFileSync(config, 'utf8').split('\n')
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const pgEnv = { ...process.env, PGHOST: '127.0.0.1', PGPORT: values.STAGE_DB_PORT || '55432',
  PGUSER: 'edocbr_stage', PGDATABASE: 'edocbr_stage', PGPASSWORD: values.STAGE_DB_PASSWORD }
const basePort = values.STAGE_REALTIME_PORT || '3103'
const peerPort = values.STAGE_REALTIME_PEER_PORT || '3104'
if (!values.STAGE_DB_PASSWORD || !values.STAGE_REALTIME_SECRET) {
  throw new Error('Credenciais sintéticas de homologação ausentes.')
}

function run(command: string[], env = process.env): string {
  const result = Bun.spawnSync(command, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`${command[0]} falhou: ${result.stderr.toString().slice(-600)}`)
  return result.stdout.toString().trim()
}

function query(sql: string): string {
  return run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], pgEnv)
}

function compose(...args: string[]): void {
  run(['docker', 'compose', '--profile', 'fanout-lab', '--env-file', config,
    '-f', composeFile, ...args])
}

async function waitFor(check: () => Promise<boolean> | boolean, label: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await check()) return } catch { /* serviço em recuperação */ }
    await Bun.sleep(200)
  }
  throw new Error(`Tempo excedido aguardando ${label}.`)
}

async function subscribe(port: string, tenantId: string, scope: 'internal' | 'public'): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}`, { path: '/', transports: ['websocket'],
      reconnection: false, autoConnect: false,
      auth: { tenantId, scope, token: scope === 'internal'
        ? issueRealtimeGrant(tenantId, 'stage-fanout-probe', values.STAGE_REALTIME_SECRET) : '' } })
    const timeout = setTimeout(() => { socket.disconnect(); reject(new Error(`Assinatura ${port}/${scope} expirou.`)) }, 8000)
    socket.once('subscribed', () => { clearTimeout(timeout); resolve(socket) })
    socket.once('subscribe_error', (error) => { clearTimeout(timeout); socket.disconnect(); reject(new Error(String(error?.error))) })
    socket.once('connect_error', (error) => { clearTimeout(timeout); socket.disconnect(); reject(error) })
    socket.connect()
  })
}

function nextEvent(socket: Socket, eventId: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('structure.changed', handler); reject(new Error(`Evento ${eventId} não chegou.`)) }, timeoutMs)
    function handler(event: any) {
      if (event?.eventId !== eventId) return
      clearTimeout(timeout)
      socket.off('structure.changed', handler)
      resolve(event)
    }
    socket.on('structure.changed', handler)
  })
}

if (query('SELECT slug FROM "Tenant" ORDER BY slug') !== 'staging-example') {
  throw new Error('Prova permitida somente na base sintética exclusiva.')
}
const tenantId = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
if (!/^c[A-Za-z0-9]{20,40}$/.test(tenantId)) throw new Error('Tenant sintético inválido.')
if (!(await fetch(`http://127.0.0.1:${basePort}/health`)).ok) throw new Error('Nó principal indisponível.')

const sockets: Socket[] = []
let peerStarted = false
let redisStopped = false
try {
  peerStarted = true
  compose('up', '-d', '--no-build', 'realtime_peer')
  await waitFor(async () => (await fetch(`http://127.0.0.1:${peerPort}/health`)).ok, 'saúde do segundo nó')
  for (const port of [basePort, peerPort]) {
    sockets.push(await subscribe(port, tenantId, 'internal'))
    sockets.push(await subscribe(port, tenantId, 'public'))
  }
  const eventId = `stagefanout${randomBytes(12).toString('hex')}`
  const arrivals = sockets.map((socket) => nextEvent(socket, eventId))
  const internal = JSON.stringify({ marker: eventId, secret: 'interno-sintetico', origin: 'cloud' }).replaceAll("'", "''")
  const publicPayload = JSON.stringify({ marker: eventId, origin: 'cloud' }).replaceAll("'", "''")
  query('INSERT INTO "OutboxEvent" (id, "tenantId", "eventType", "aggregateId", '
    + '"internalPayload", "publicPayload", status, "createdAt") VALUES '
    + `('${eventId}', '${tenantId}', 'structure.changed', '${eventId}', '${internal}', '${publicPayload}', 'pending', now())`)
  const received = await Promise.all(arrivals)
  for (let index = 0; index < received.length; index++) {
    const event = received[index]
    if (event.tenantId !== tenantId || event.payload?.marker !== eventId) throw new Error('Escopo ou payload divergente.')
    if (index % 2 === 0 && event.payload?.secret !== 'interno-sintetico') throw new Error('Escopo interno incompleto.')
    if (index % 2 === 1 && 'secret' in event.payload) throw new Error('Segredo interno vazou no escopo público.')
  }
  await waitFor(() => query(`SELECT status FROM "OutboxEvent" WHERE id='${eventId}'`) === 'published',
    'confirmação da outbox')
  redisStopped = true
  compose('stop', 'redis')
  await waitFor(async () => !(await fetch(`http://127.0.0.1:${basePort}/health`)).ok
    && !(await fetch(`http://127.0.0.1:${peerPort}/health`)).ok, 'health degradado dos dois nós')
  const heldId = `stagefanout${randomBytes(12).toString('hex')}`
  const heldArrivals = sockets.map((socket) => nextEvent(socket, heldId, 30000))
  const heldInternal = JSON.stringify({ marker: heldId, secret: 'interno-sintetico', origin: 'cloud' }).replaceAll("'", "''")
  const heldPublic = JSON.stringify({ marker: heldId, origin: 'cloud' }).replaceAll("'", "''")
  query('INSERT INTO "OutboxEvent" (id, "tenantId", "eventType", "aggregateId", '
    + '"internalPayload", "publicPayload", status, "createdAt") VALUES '
    + `('${heldId}', '${tenantId}', 'structure.changed', '${heldId}', '${heldInternal}', '${heldPublic}', 'pending', now())`)
  await Bun.sleep(1500)
  if (query(`SELECT status FROM "OutboxEvent" WHERE id='${heldId}'`) !== 'pending') {
    throw new Error('Outbox publicou enquanto Redis estava indisponível.')
  }
  compose('start', 'redis')
  redisStopped = false
  await waitFor(async () => (await fetch(`http://127.0.0.1:${basePort}/health`)).ok
    && (await fetch(`http://127.0.0.1:${peerPort}/health`)).ok, 'fanout após recuperação do Redis')
  const heldReceived = await Promise.all(heldArrivals)
  if (heldReceived.some((event) => event.payload?.marker !== heldId)) {
    throw new Error('Evento recuperado divergente.')
  }
  await waitFor(() => query(`SELECT status FROM "OutboxEvent" WHERE id='${heldId}'`) === 'published',
    'publicação da outbox recuperada')
  console.log(JSON.stringify({ ok: true, synthetic: true, tenant: 'staging-example',
    nodes: 2, subscribers: sockets.length, eventId, internalSubscribers: 2, publicSubscribers: 2,
    isolatedPublicPayload: true, outboxPublished: true, redisOutageHeldOutbox: true,
    redisRecoveryDeliveredToAll: true }))
} finally {
  for (const socket of sockets) socket.disconnect()
  if (redisStopped) compose('start', 'redis')
  if (peerStarted) compose('stop', 'realtime_peer')
}
