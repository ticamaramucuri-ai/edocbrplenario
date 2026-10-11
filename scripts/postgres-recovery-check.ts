/** Start the production build against the restored post-write database and read the new session. */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

const clientPath = process.env.POSTGRES_TEST_CLIENT
const entry = process.env.EDOCBR_STANDALONE_SERVER
if (!clientPath || !entry || !existsSync(entry)) throw new Error('build e cliente de recuperação são obrigatórios')
const { PrismaClient } = await import(clientPath)
const db = new PrismaClient()

async function freePort(): Promise<number> {
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('porta indisponível')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return address.port
}

const tenants = await db.tenant.findMany({ where: { slug: { startsWith: 'pg-write-' } }, select: { id: true, slug: true } })
const tenant = tenants.find((row: { slug: string }) => !row.slug.startsWith('pg-write-cross-'))
if (!tenant) throw new Error('Câmara de ensaio ausente após restauração')
const session = await db.session.findFirst({ where: { tenantId: tenant.id, status: 'closed' }, select: { id: true } })
if (!session || await db.vote.count({ where: { voting: { sessionId: session.id } } }) !== 1)
  throw new Error('sessão ou voto ausente após restauração')

const port = await freePort()
const logFd = openSync(join(dirname(clientPath), 'recovery-http.log'), 'w', 0o600)
const server = spawn('node', [entry], { cwd: dirname(entry),
  env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', LEGIS_DEMO_MODE: 'false' },
  stdio: ['ignore', logFd, logFd] })
closeSync(logFd)

try {
  const deadline = Date.now() + 30_000
  let found = false
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('servidor de recuperação encerrou')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/public/sessions/${encodeURIComponent(session.id)}?tenant=${encodeURIComponent(tenant.slug)}`,
        { signal: AbortSignal.timeout(5_000) })
      if (response.status === 200) {
        const body = await response.json()
        if (body?.session?.id === session.id && body?.session?.status === 'closed' && body?.votings?.length === 1) {
          found = true
          break
        }
      }
    } catch { /* inicialização */ }
    await Bun.sleep(200)
  }
  if (!found) throw new Error('sessão restaurada não ficou disponível via HTTP')
  console.log('Recuperação HTTP: sessão encerrada e resultado de votação disponíveis.')
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => server.once('exit', () => resolve()))
  }
  await db.$disconnect()
}
