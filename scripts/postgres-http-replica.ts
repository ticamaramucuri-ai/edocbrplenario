/** HTTP smoke on a restored PostgreSQL replica; only GET requests. */
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

const clientPath = process.env.POSTGRES_TEST_CLIENT
if (!clientPath || !process.env.DATABASE_URL?.startsWith('postgresql://'))
  throw new Error('cliente e URL PostgreSQL de ensaio são obrigatórios')
const { PrismaClient } = await import(clientPath)
const db = new PrismaClient()

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('porta indisponível')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function request(url: string, actorId?: string) {
  const start = performance.now()
  const response = await fetch(url, {
    headers: actorId ? { 'x-actor-id': actorId } : {},
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body, ms: performance.now() - start }
}

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const logPath = join(dirname(clientPath), 'http-smoke.log')
const logFd = openSync(logPath, 'w', 0o600)
const server = spawn('node', ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: process.cwd(),
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', LEGIS_DEMO_MODE: 'true' },
  stdio: ['ignore', logFd, logFd],
})
closeSync(logFd)

try {
  const candidates = await db.tenant.findMany({
    where: { active: true, sessions: { some: { status: { not: 'draft' } } } },
    select: { id: true, slug: true, sessions: { where: { status: { not: 'draft' } }, select: { id: true } },
      users: { where: { active: true, role: { in: ['tenant_admin', 'session_operator'] } }, select: { id: true } } },
  })
  const usable = candidates.filter((tenant: { users: unknown[]; sessions: unknown[] }) => tenant.users.length && tenant.sessions.length)
  if (usable.length < 2) throw new Error('duas Câmaras de ensaio com sessão e ator são necessárias')
  const [a, b] = usable
  const listA = `${base}/api/v1/public/sessions?tenant=${encodeURIComponent(a.slug)}`
  const deadline = Date.now() + 90_000
  let warmStatus = 0
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('servidor HTTP encerrou antes do teste')
    try {
      const warm = await request(listA)
      warmStatus = warm.status
      if (warm.status === 200) break
    } catch { /* compilação inicial */ }
    await Bun.sleep(300)
  }
  if (warmStatus !== 200) throw new Error(`servidor HTTP não ficou pronto (último status ${warmStatus})`)

  const listB = `${base}/api/v1/public/sessions?tenant=${encodeURIComponent(b.slug)}`
  const detailA = `${base}/api/v1/public/sessions/${encodeURIComponent(a.sessions[0].id)}?tenant=${encodeURIComponent(a.slug)}`
  const crossPublic = `${base}/api/v1/public/sessions/${encodeURIComponent(a.sessions[0].id)}?tenant=${encodeURIComponent(b.slug)}`
  const privateA = `${base}/api/v1/sessions/${encodeURIComponent(a.sessions[0].id)}`
  const [publicA, publicB, detail, deniedPublic, own, deniedPrivate, anonymous] = await Promise.all([
    request(listA), request(listB), request(detailA), request(crossPublic),
    request(privateA, a.users[0].id), request(privateA, b.users[0].id), request(privateA),
  ])
  const idsA = new Set(a.sessions.map((session: { id: string }) => session.id))
  const idsB = new Set(b.sessions.map((session: { id: string }) => session.id))
  if (publicA.status !== 200 || !publicA.body?.sessions?.every((session: { id: string }) => idsA.has(session.id)) ||
      publicB.status !== 200 || !publicB.body?.sessions?.every((session: { id: string }) => idsB.has(session.id)))
    throw new Error('listas públicas não respeitam o escopo da Câmara')
  if (detail.status !== 200 || detail.body?.session?.id !== a.sessions[0].id || deniedPublic.status !== 404)
    throw new Error('detalhe público ou isolamento falhou')
  if (own.status !== 200 || own.body?.session?.id !== a.sessions[0].id ||
      ![403, 404].includes(deniedPrivate.status) || anonymous.status !== 401)
    throw new Error(`acesso autenticado falhou (${own.status}/${deniedPrivate.status}/${anonymous.status})`)

  const samples = await Promise.all(Array.from({ length: 40 }, () => request(detailA)))
  if (samples.some((sample) => sample.status !== 200 || sample.body?.session?.id !== a.sessions[0].id))
    throw new Error('erro ou resposta divergente nas 40 leituras concorrentes')
  const latencies = samples.map((sample) => sample.ms).sort((x, y) => x - y)
  const p95 = Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1])
  const max = Math.round(latencies.at(-1) ?? 0)
  if (p95 > 3_000) throw new Error(`p95 de ${p95} ms excedeu o limite local de 3000 ms`)
  console.log(JSON.stringify({ httpChecks: 7, concurrentReads: 40, errors: 0, p95Ms: p95, maxMs: max,
    environment: 'Next dev em loopback, réplica PostgreSQL descartável' }))
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => server.once('exit', () => resolve()))
  }
  await db.$disconnect()
}
