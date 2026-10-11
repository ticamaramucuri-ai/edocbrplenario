/** Production HTTP write journey against a disposable restored PostgreSQL replica. */
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

const clientPath = process.env.POSTGRES_TEST_CLIENT
const entry = process.env.EDOCBR_STANDALONE_SERVER
if (!clientPath || !entry || !existsSync(entry) || !process.env.DATABASE_URL?.startsWith('postgresql://'))
  throw new Error('cliente, build e URL PostgreSQL de ensaio são obrigatórios')
const { PrismaClient } = await import(clientPath)
const db = new PrismaClient()

function passwordHash(password: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`
}

async function freePort(): Promise<number> {
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('porta indisponível')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return address.port
}

type HttpResult = { status: number; body: any; cookie: string | null }
async function call(base: string, path: string, method = 'GET', body?: unknown, cookie?: string): Promise<HttpResult> {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  return { status: response.status, body: await response.json().catch(() => null),
    cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? null }
}

function expectStatus(result: HttpResult, status: number, label: string): void {
  if (result.status !== status) throw new Error(`${label}: HTTP ${result.status}, esperado ${status}; código ${result.body?.code ?? 'sem código'}`)
}

const suffix = randomUUID()
const password = `Ensaio-${randomBytes(12).toString('hex')}`
const settings = JSON.stringify({ quorumMinimum: 1 })
const a = await db.tenant.create({ data: { slug: `pg-write-${suffix}`, name: 'Câmara de ensaio A', city: 'Teste', uf: 'BA', settings } })
const b = await db.tenant.create({ data: { slug: `pg-write-cross-${suffix}`, name: 'Câmara de ensaio B', city: 'Teste', uf: 'BA', settings } })
const actor = await db.user.create({ data: { tenantId: a.id, name: 'Operador de ensaio',
  email: `owner-${suffix}@example.invalid`, role: 'tenant_admin', passwordHash: passwordHash(password) } })
const voteOperator = await db.user.create({ data: { tenantId: a.id, name: 'Mesa de ensaio',
  email: `vote-${suffix}@example.invalid`, role: 'session_operator', passwordHash: passwordHash(password) } })
const crossActor = await db.user.create({ data: { tenantId: b.id, name: 'Operador cruzado',
  email: `cross-${suffix}@example.invalid`, role: 'tenant_admin', passwordHash: passwordHash(password) } })
const president = await db.parliamentarian.create({ data: { tenantId: a.id, name: 'Presidência de ensaio', party: 'SEM', boardRole: 'presidente' } })
const matter = await db.legislativeMatter.create({ data: { tenantId: a.id, type: 'projeto_de_lei',
  number: 1, year: 2027, ementa: 'Matéria de ensaio PostgreSQL', authors: '[]' } })

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const logPath = join(dirname(clientPath), 'production-smoke.log')
const logFd = openSync(logPath, 'w', 0o600)
const server = spawn('node', [entry], { cwd: dirname(entry),
  env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', LEGIS_DEMO_MODE: 'false' },
  stdio: ['ignore', logFd, logFd] })
closeSync(logFd)

try {
  const readyPath = `/api/v1/public/sessions?tenant=${encodeURIComponent(a.slug)}`
  const deadline = Date.now() + 60_000
  let ready = false
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('build de produção encerrou antes de responder')
    try {
      if ((await call(base, readyPath)).status === 200) { ready = true; break }
    } catch { /* inicialização */ }
    await Bun.sleep(250)
  }
  if (!ready) throw new Error('build de produção não ficou pronto')

  const login = async (email: string) => {
    const result = await call(base, '/api/v1/auth/login', 'POST', { email, password })
    expectStatus(result, 200, 'login real')
    if (!result.cookie?.startsWith('legis_session=')) throw new Error('cookie de sessão ausente')
    return result.cookie
  }
  const ownerCookie = await login(actor.email)
  const voteCookie = await login(voteOperator.email)
  const crossCookie = await login(crossActor.email)
  const unauthenticated = await call(base, '/api/v1/sessions')
  expectStatus(unauthenticated, 401, 'sessões sem cookie')

  const created = await call(base, '/api/v1/sessions', 'POST', {
    type: 'ordinaria', scheduledAt: '2027-01-20T13:00:00.000Z',
    presidentId: president.id, matterIds: [matter.id],
  }, ownerCookie)
  expectStatus(created, 201, 'criar sessão')
  const sessionId = created.body?.session?.id as string
  if (!sessionId) throw new Error('sessão criada sem ID')
  const sessionPath = `/api/v1/sessions/${encodeURIComponent(sessionId)}`
  const transition = async (action: string, version: number, cookie = ownerCookie) =>
    call(base, `${sessionPath}/transition`, 'POST', { action, version }, cookie)

  expectStatus(await transition('schedule', 1, crossCookie), 403, 'isolamento de escrita')
  expectStatus(await transition('schedule', 1), 200, 'publicar pauta')
  expectStatus(await transition('open_checkin', 2), 200, 'abrir credenciamento')
  expectStatus(await call(base, `${sessionPath}/attendance`, 'POST', {
    parliamentarianId: president.id, action: 'check_in',
  }, ownerCookie), 200, 'registrar presença')
  expectStatus(await transition('open_session', 3), 200, 'abrir sessão')
  const agendaItem = await db.agendaItem.findFirstOrThrow({ where: { sessionId, matterId: matter.id } })
  const voting = await call(base, `${sessionPath}/votings`, 'POST', { agendaItemId: agendaItem.id, mode: 'nominal' }, ownerCookie)
  expectStatus(voting, 201, 'criar votação')
  const votingId = voting.body?.voting?.id as string
  if (!votingId) throw new Error('votação criada sem ID')
  const votingPath = `/api/v1/votings/${encodeURIComponent(votingId)}`
  expectStatus(await call(base, `${votingPath}/transition`, 'POST', { action: 'open', version: 1 }, ownerCookie), 200, 'abrir votação')
  const commandId = randomUUID()
  const voteBody = { parliamentarianId: president.id, value: 'sim', commandId }
  expectStatus(await call(base, `${votingPath}/votes`, 'POST', voteBody, voteCookie), 200, 'registrar voto')
  expectStatus(await call(base, `${votingPath}/votes`, 'POST', voteBody, voteCookie), 200, 'voto idempotente')
  expectStatus(await call(base, `${votingPath}/transition`, 'POST', { action: 'close', version: 2 }, ownerCookie), 200, 'encerrar votação')
  expectStatus(await transition('close', 4), 200, 'encerrar sessão')
  const publicDetail = await call(base, `/api/v1/public/sessions/${encodeURIComponent(sessionId)}?tenant=${encodeURIComponent(a.slug)}`)
  expectStatus(publicDetail, 200, 'resultado público')
  if (publicDetail.body?.session?.status !== 'closed' || publicDetail.body?.votings?.length !== 1)
    throw new Error('resultado público divergente')
  expectStatus(await call(base, `/api/v1/public/sessions/${encodeURIComponent(sessionId)}?tenant=${encodeURIComponent(b.slug)}`),
    404, 'isolamento público')
  if (await db.vote.count({ where: { votingId } }) !== 1) throw new Error('voto idempotente duplicou no banco')
  console.log(JSON.stringify({ productionHttp: true, writeSteps: 11, voteRows: 1,
    authentication: 'cookie real', isolation: 'publicação e escrita entre Câmaras' }))
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => server.once('exit', () => resolve()))
  }
  await db.$disconnect()
}
