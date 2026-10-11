import { createHmac } from 'crypto'
import { createServer as createHttpServer } from 'http'
import { createServer as createNetServer } from 'net'
import { expect, test } from 'bun:test'
import { PrismaClient } from '@prisma/client'
import { io, type Socket } from 'socket.io-client'
import { issueRealtimeGrant } from '../src/lib/realtime-auth'

async function freePort(used: Set<number>): Promise<number> {
  while (true) {
    const server = createNetServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('porta indisponível')
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (!used.has(address.port)) { used.add(address.port); return address.port }
  }
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await check()) return } catch { /* serviço ainda inicializando */ }
    await Bun.sleep(100)
  }
  throw new Error(`Tempo esgotado: ${label}`)
}

function subscribed(url: string, tenantId: string, scope: 'public' | 'internal', token = ''): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { path: '/', transports: ['websocket'], autoConnect: false,
      reconnection: false, auth: { tenantId, scope, token } })
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('subscribe timeout')) }, 5000)
    socket.once('subscribed', () => { clearTimeout(timer); resolve(socket) })
    socket.once('subscribe_error', (error) => { clearTimeout(timer); socket.disconnect(); reject(new Error(String(error?.error))) })
    socket.once('connect_error', (error) => { clearTimeout(timer); socket.disconnect(); reject(error) })
    socket.connect()
  })
}

function nextEvent(socket: Socket, eventType: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Evento ${eventType} não recebido`)), 5000)
    socket.once(eventType, (event) => { clearTimeout(timer); resolve(event) })
  })
}

test('três serviços PostgreSQL: salas isoladas, webhook assinado e health conjunto', async () => {
  const db = new PrismaClient()
  const used = new Set<number>()
  const realtimePort = await freePort(used)
  const webhookPort = await freePort(used)
  const schedulerPort = await freePort(used)
  const receiverPort = await freePort(used)
  const secret = 'teste-integrado-postgres-uma-chave-de-32-bytes'
  const received: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> = []
  const receiver = createHttpServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    received.push({ body, headers: req.headers })
    res.writeHead(204)
    res.end()
  })
  await new Promise<void>((resolve) => receiver.listen(receiverPort, '127.0.0.1', resolve))
  const commonEnv = { ...process.env, REALTIME_AUTH_SECRET: secret,
    REALTIME_PORT: String(realtimePort), WEBHOOKS_PORT: String(webhookPort), SCHEDULER_PORT: String(schedulerPort),
    REALTIME_HEALTH_URL: `http://127.0.0.1:${realtimePort}/health`,
    WEBHOOKS_HEALTH_URL: `http://127.0.0.1:${webhookPort}/health`,
  }
  const processes = [
    Bun.spawn(['bun', 'mini-services/realtime/index.ts'], { env: { ...commonEnv, REALTIME_DATABASE_PROVIDER: 'postgresql' }, stdout: 'ignore', stderr: 'pipe' }),
    Bun.spawn(['bun', 'mini-services/webhooks/index.ts'], { env: { ...commonEnv, WEBHOOKS_DATABASE_PROVIDER: 'postgresql' }, stdout: 'ignore', stderr: 'pipe' }),
    Bun.spawn(['bun', 'mini-services/scheduler/postgres.ts'], { env: commonEnv, stdout: 'ignore', stderr: 'pipe' }),
  ]
  const sockets: Socket[] = []
  try {
    for (const [port, label] of [[realtimePort, 'realtime'], [webhookPort, 'webhooks'], [schedulerPort, 'scheduler']] as const) {
      await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok, label)
    }
    const suffix = crypto.randomUUID()
    const a = await db.tenant.create({ data: { slug: `e2e-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
    const b = await db.tenant.create({ data: { slug: `e2e-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
    const url = `http://127.0.0.1:${realtimePort}`
    const aPublic = await subscribed(url, a.id, 'public')
    const aInternal = await subscribed(url, a.id, 'internal', issueRealtimeGrant(a.id, 'operator', secret))
    const bPublic = await subscribed(url, b.id, 'public')
    sockets.push(aPublic, aInternal, bPublic)
    const aPublicEvent = nextEvent(aPublic, 'integration.smoke')
    const aInternalEvent = nextEvent(aInternal, 'integration.smoke')
    const bPublicEvent = nextEvent(bPublic, 'integration.smoke')

    const endpoint = await db.webhookEndpoint.create({ data: {
      tenantId: a.id, url: `http://127.0.0.1:${receiverPort}/hook`, secret: 'segredo-receptor', events: '["integration.smoke"]',
    } })
    const delivery = await db.webhookDelivery.create({ data: {
      endpointId: endpoint.id, eventType: 'integration.smoke', payload: JSON.stringify({ tenantId: a.id, marker: suffix }),
    } })
    const [eventA, eventB] = await Promise.all([a, b].map((tenant) => db.outboxEvent.create({ data: {
      tenantId: tenant.id, eventType: 'integration.smoke', aggregateId: tenant.id,
      internalPayload: JSON.stringify({ marker: tenant.id, secret: 'interno', origin: 'cloud' }),
      publicPayload: JSON.stringify({ marker: tenant.id, origin: 'cloud' }),
    } })))
    const [publicA, internalA, publicB] = await Promise.all([aPublicEvent, aInternalEvent, bPublicEvent])
    expect(publicA).toMatchObject({ eventId: eventA.id, tenantId: a.id, payload: { marker: a.id } })
    expect(publicA.payload).not.toHaveProperty('secret')
    expect(internalA).toMatchObject({ eventId: eventA.id, tenantId: a.id, payload: { secret: 'interno' } })
    expect(publicB).toMatchObject({ eventId: eventB.id, tenantId: b.id, payload: { marker: b.id } })
    await waitFor(async () => (await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status === 'success', 'webhook entregue')
    await waitFor(async () => (await db.outboxEvent.count({ where: { id: { in: [eventA.id, eventB.id] }, status: 'published' } })) === 2, 'outbox confirmado')
    expect(received).toHaveLength(1)
    expect(received[0]?.headers['x-legis-delivery-id']).toBe(delivery.id)
    expect(received[0]?.headers['x-legis-signature']).toBe(`sha256=${createHmac('sha256', 'segredo-receptor').update(received[0]!.body).digest('hex')}`)
    const healthResult = await (await fetch(`http://127.0.0.1:${schedulerPort}/jobs/health.check/run`, { method: 'POST' })).json()
    expect(healthResult).toMatchObject({ status: 'ok' })
    expect(healthResult.note).toContain('db ok')
  } finally {
    for (const socket of sockets) socket.disconnect()
    for (const process of processes) process.kill('SIGTERM')
    await Promise.all(processes.map((process) => process.exited))
    await new Promise<void>((resolve) => receiver.close(() => resolve()))
    await db.$disconnect()
  }
}, 30000)
