import { createServer } from 'http'
import { PrismaClient } from '@prisma/client'
import { createPostgresScheduler, KNOWN_KINDS } from './postgres-core'

if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Scheduler PostgreSQL exige DATABASE_URL PostgreSQL e cliente Prisma gerado para esse provedor')
}

const db = new PrismaClient()
const PORT = Number(process.env.SCHEDULER_PORT || 3005)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('SCHEDULER_PORT inválida')
const TICK_INTERVAL_MS = 30_000
const scheduler = createPostgresScheduler(db, async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000), cache: 'no-store' })
    await response.text().catch(() => '')
    return response.ok
  } catch { return false }
})

const server = createServer((req, res) => {
  const pathname = (req.url ?? '').split('?')[0] ?? '/'
  if (req.method === 'GET' && (pathname === '/health' || pathname.startsWith('/health/'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'scheduler', port: PORT, provider: 'postgresql' }))
    return
  }
  const match = req.method === 'POST' ? pathname.match(/^\/jobs\/([^/]+)\/run$/) : null
  if (match) {
    let kind: string
    try { kind = decodeURIComponent(match[1]!) }
    catch { kind = '' }
    if (!KNOWN_KINDS.includes(kind as typeof KNOWN_KINDS[number])) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `Kind desconhecido: "${kind}".` }))
      return
    }
    void scheduler.runManual(kind).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    }).catch((error) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'error', note: String(error).slice(0, 300) }))
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
})

let ticking = false
async function tick() {
  if (ticking) return
  ticking = true
  try { await scheduler.tick() }
  catch (error) { console.error(JSON.stringify({ level: 'error', msg: 'scheduler tick falhou', error: String(error) })) }
  finally { ticking = false }
}
server.listen(PORT, () => console.log(JSON.stringify({ level: 'info', msg: 'scheduler PostgreSQL iniciado', port: PORT })))
const timer = setInterval(() => void tick(), TICK_INTERVAL_MS)
setTimeout(() => void tick(), 1500)

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(timer)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await db.$disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
