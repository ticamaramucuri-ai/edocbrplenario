/** Local two-server race for official symbolic tally on disposable PostgreSQL. */
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const databaseUrl = process.env.DATABASE_URL
const standaloneServer = process.env.EDOCBR_STANDALONE_SERVER
if (!databaseUrl?.startsWith('postgresql://') || !standaloneServer || !existsSync(standaloneServer)) {
  throw new Error('DATABASE_URL PostgreSQL e EDOCBR_STANDALONE_SERVER descartável são obrigatórios.')
}

const db = new PrismaClient()
const suffix = randomUUID()
const tenantSlug = `symbolic-http-race-${suffix}`
const ports = []
const servers = []
const logPaths = []
const password = 'PostgresRace!2038'
const salt = randomBytes(16)
const passwordHash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`

async function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
  const port = server.port
  server.stop(true)
  return port
}

async function startServer(index) {
  const port = await freePort()
  ports.push(port)
  const logPath = `/tmp/edocbr-symbolic-http-race-${process.pid}-${index}.log`
  logPaths.push(logPath)
  const log = Bun.file(logPath)
  const writer = log.writer()
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1',
      DATABASE_URL: databaseUrl, REALTIME_AUTH_SECRET: randomUUID() },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => writer.write(chunk))
  child.stderr.on('data', (chunk) => writer.write(chunk))
  servers.push({ child, writer })
  return `http://127.0.0.1:${port}`
}

async function waitReady(base) {
  const deadline = Date.now() + 90_000
  let lastStatus = 'sem resposta'
  while (Date.now() < deadline) {
    const child = servers[ports.indexOf(Number(new URL(base).port))]?.child
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Instância HTTP encerrou com ${child.exitCode}.`)
    try {
      const response = await fetch(`${base}/api/v1/health?ready=1`, { signal: AbortSignal.timeout(2_000) })
      lastStatus = String(response.status)
      if (response.ok) return
    } catch (error) { lastStatus = error.message }
    await Bun.sleep(300)
  }
  throw new Error(`Instância HTTP não ficou pronta: ${base}; último estado ${lastStatus}.`)
}

async function cleanupFixture(ids) {
  if (!ids.tenantId) return
  await db.$transaction(async (tx) => {
    for (const votingId of ids.votingIds) {
      await tx.symbolicTallyRevision.deleteMany({ where: { votingId } })
      await tx.votingOption.deleteMany({ where: { votingId } })
      await tx.vote.deleteMany({ where: { votingId } })
      await tx.voting.deleteMany({ where: { id: votingId } })
    }
    await tx.auditEvent.deleteMany({ where: { tenantId: ids.tenantId } })
    await tx.outboxEvent.deleteMany({ where: { tenantId: ids.tenantId } })
    await tx.notification.deleteMany({ where: { tenantId: ids.tenantId } })
    if (ids.sessionId) {
      await tx.attendanceEvent.deleteMany({ where: { sessionId: ids.sessionId } })
      await tx.agendaItem.deleteMany({ where: { sessionId: ids.sessionId } })
      await tx.session.deleteMany({ where: { id: ids.sessionId } })
    }
    await tx.user.deleteMany({ where: { tenantId: ids.tenantId } })
    await tx.parliamentarian.deleteMany({ where: { tenantId: ids.tenantId } })
    await tx.tenant.deleteMany({ where: { id: ids.tenantId } })
  })
}

const ids = { tenantId: null, sessionId: null, votingIds: [] }
try {
  const tenant = await db.tenant.create({ data: { slug: tenantSlug, name: 'Câmara Corrida HTTP', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 1 }) } })
  ids.tenantId = tenant.id
  const actors = await Promise.all([
    { name: 'Secretaria HTTP A', role: 'session_operator' },
    { name: 'Secretaria HTTP B', role: 'session_operator' },
    { name: 'Presidência HTTP', role: 'presiding_officer' },
    { name: 'Administração HTTP', role: 'tenant_admin' },
  ].map(({ name, role }, index) => db.user.create({ data: {
    tenantId: tenant.id, name, email: `symbolic-http-${index}-${suffix}@example.invalid`, role, passwordHash,
  } })))
  const members = await Promise.all(['Parlamentar A', 'Parlamentar B'].map((name, order) => db.parliamentarian.create({
    data: { tenantId: tenant.id, name, party: 'ENSAIO', order },
  })))
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2038,
    scheduledAt: new Date('2038-01-01T12:00:00.000Z'), openedAt: new Date(), status: 'open', official: true } })
  ids.sessionId = session.id
  for (const member of members) await db.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Contagem concorrente HTTP?', mode: 'simbolico', status: 'open',
    rule: 'maioria_simples', requiredQuorum: 1, quorumAtOpen: 1, memberBaseAtOpen: 2, presentAtOpen: 2,
    eligibleVoterIdsAtOpen: JSON.stringify(members.map((member) => member.id)), version: 7 } })
  ids.votingIds.push(voting.id)
  await db.votingOption.createMany({ data: [
    { votingId: voting.id, key: 'a_favor', label: 'A favor', order: 0 },
    { votingId: voting.id, key: 'contra', label: 'Contra', order: 1 },
  ] })

  const bases = await Promise.all([startServer(0), startServer(1)])
  await Promise.all(bases.map(waitReady))
  async function login(base, actor) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: actor.email, password }), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Login HTTP de ${actor.name} falhou: ${response.status} ${await response.text()}`)
    const cookie = response.headers.get('set-cookie')?.match(/legis_session=([^;]+)/)?.[1]
    if (!cookie) throw new Error(`Login HTTP de ${actor.name} não devolveu cookie de sessão.`)
    return `legis_session=${cookie}`
  }
  const cookies = await Promise.all(actors.map((actor, index) => login(bases[index % bases.length], actor)))
  const endpoint = `/api/v1/votings/${voting.id}/symbolic-tally`
  const requests = await Promise.all(bases.map(async (base, index) => {
    const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: {
      'content-type': 'application/json', cookie: cookies[index],
    }, body: JSON.stringify({ action: 'propose', version: 7,
      customCounts: index === 0 ? { a_favor: 2, contra: 0 } : { a_favor: 0, contra: 2 } }),
      signal: AbortSignal.timeout(20_000),
    })
    return { status: response.status, body: await response.json() }
  }))
  const statuses = requests.map((result) => result.status).sort((a, b) => a - b)
  if (JSON.stringify(statuses) !== JSON.stringify([200, 409])) {
    throw new Error(`Duas instâncias HTTP deveriam responder 200/409; recebido ${statuses.join('/')}: ${JSON.stringify(requests)}`)
  }
  const accepted = requests.find((result) => result.status === 200)
  const [revisions, current, auditCount] = await Promise.all([
    db.symbolicTallyRevision.findMany({ where: { votingId: voting.id } }),
    db.voting.findUniqueOrThrow({ where: { id: voting.id } }),
    db.auditEvent.count({ where: { tenantId: tenant.id, aggregateId: voting.id, action: 'voting.symbolic_tally.proposed' } }),
  ])
  if (revisions.length !== 1 || revisions[0].id !== accepted.body?.revision?.id || current.version !== 8 || auditCount !== 1) {
    throw new Error(`Persistência concorrente inconsistente: revisões=${revisions.length}, versão=${current.version}, auditorias=${auditCount}.`)
  }
  const counts = JSON.parse(revisions[0].countsJson)
  const expectedCounts = counts.a_favor === 2 && counts.contra === 0 || counts.a_favor === 0 && counts.contra === 2
  if (!expectedCounts || accepted.body?.revision?.proposedById !== actors.find((_, index) => requests[index] === accepted)?.id) {
    throw new Error(`A revisão aceita não corresponde a uma proposta completa: ${JSON.stringify({ counts, proposer: accepted.body?.revision?.proposedById })}`)
  }

  const confirmationRace = await Promise.all([0, 1].map(async (index) => {
    const response = await fetch(`${bases[index]}${endpoint}`, { method: 'POST', headers: {
      'content-type': 'application/json', cookie: cookies[index + 2],
    }, body: JSON.stringify({ action: 'confirm', version: 8, revisionId: revisions[0].id }),
      signal: AbortSignal.timeout(20_000),
    })
    return { status: response.status, body: await response.json() }
  }))
  const confirmationStatuses = confirmationRace.map((result) => result.status).sort((a, b) => a - b)
  if (JSON.stringify(confirmationStatuses) !== JSON.stringify([200, 409])) {
    throw new Error(`Confirmações simultâneas deveriam responder 200/409: ${JSON.stringify(confirmationRace)}`)
  }
  const confirmed = await db.symbolicTallyRevision.findUniqueOrThrow({ where: { id: revisions[0].id } })
  const confirmedVoting = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  const confirmedAuditCount = await db.auditEvent.count({ where: { tenantId: tenant.id, aggregateId: voting.id,
    action: 'voting.symbolic_tally.confirmed' } })
  if (!confirmed.confirmedAt || confirmed.confirmedById === confirmed.proposedById || confirmedVoting.version !== 9 || confirmedAuditCount !== 1) {
    throw new Error(`Confirmação concorrente inconsistente: revisão=${confirmed.id}, versão=${confirmedVoting.version}, auditorias=${confirmedAuditCount}.`)
  }
  const closeResponse = await fetch(`${bases[1]}/api/v1/votings/${voting.id}/transition`, { method: 'POST', headers: {
    'content-type': 'application/json', cookie: cookies[1],
  }, body: JSON.stringify({ action: 'close', version: 9 }), signal: AbortSignal.timeout(20_000) })
  const closeBody = await closeResponse.json()
  if (closeResponse.status !== 200) throw new Error(`Fechamento após conferência falhou: ${closeResponse.status} ${JSON.stringify(closeBody)}`)
  const closedVoting = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  if (closedVoting.status !== 'closed' || closedVoting.version !== 10 || closedVoting.resultStatus !== 'aprovado') {
    throw new Error(`Fechamento não consumiu a revisão confirmada: ${JSON.stringify(closedVoting)}`)
  }

  const closeRaceVoting = await db.voting.create({ data: { sessionId: session.id,
    question: 'Proposta concorrendo com encerramento?', mode: 'simbolico', status: 'open', rule: 'maioria_simples',
    requiredQuorum: 1, quorumAtOpen: 1, memberBaseAtOpen: 2, presentAtOpen: 2,
    eligibleVoterIdsAtOpen: JSON.stringify(members.map((member) => member.id)), version: 7,
  } })
  ids.votingIds.push(closeRaceVoting.id)
  await db.votingOption.createMany({ data: [
    { votingId: closeRaceVoting.id, key: 'a_favor', label: 'A favor', order: 0 },
    { votingId: closeRaceVoting.id, key: 'contra', label: 'Contra', order: 1 },
  ] })
  const proposalCloseRace = await Promise.all([
    fetch(`${bases[0]}/api/v1/votings/${closeRaceVoting.id}/symbolic-tally`, { method: 'POST', headers: {
      'content-type': 'application/json', cookie: cookies[0],
    }, body: JSON.stringify({ action: 'propose', version: 7, customCounts: { a_favor: 1, contra: 1 } }),
      signal: AbortSignal.timeout(20_000),
    }),
    fetch(`${bases[1]}/api/v1/votings/${closeRaceVoting.id}/transition`, { method: 'POST', headers: {
      'content-type': 'application/json', cookie: cookies[1],
    }, body: JSON.stringify({ action: 'close', version: 7 }), signal: AbortSignal.timeout(20_000),
    }),
  ])
  const proposalCloseStatuses = proposalCloseRace.map((response) => response.status).sort((a, b) => a - b)
  if (JSON.stringify(proposalCloseStatuses) !== JSON.stringify([200, 409])) {
    throw new Error(`Proposta/fechamento concorrentes deveriam responder 200/409: ${proposalCloseStatuses}`)
  }
  const closeRaceState = await db.voting.findUniqueOrThrow({ where: { id: closeRaceVoting.id } })
  const closeRaceRevisionCount = await db.symbolicTallyRevision.count({ where: { votingId: closeRaceVoting.id } })
  if (closeRaceState.status !== 'open' || closeRaceState.version !== 8 || closeRaceRevisionCount !== 1) {
    throw new Error(`Tentativa concorrente encerrou ou duplicou revisão sem confirmação: status=${closeRaceState.status}, versão=${closeRaceState.version}, revisões=${closeRaceRevisionCount}.`)
  }
  console.log(JSON.stringify({ ok: true, database: 'PostgreSQL descartável', appInstances: 2,
    proposalStatuses: statuses, revisionCount: revisions.length, votingVersion: current.version,
    auditCount, counts, confirmationStatuses, confirmedById: confirmed.confirmedById,
    closedWithConfirmedRevision: closedVoting.status === 'closed', proposalCloseStatuses,
    remainedOpenWithoutConfirmation: closeRaceState.status === 'open', distinctProcesses: servers.length === 2 &&
      servers[0].child.pid !== servers[1].child.pid }, null, 2))
} catch (error) {
  for (let index = 0; index < logPaths.length; index++) {
    try { console.error(`Instância HTTP ${index + 1} log:\n${await Bun.file(logPaths[index]).text()}`) } catch {}
  }
  throw error
} finally {
  await Promise.all(servers.map(async ({ child, writer }) => {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM') } catch {}
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), Bun.sleep(5_000)])
      if (child.exitCode === null) try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }
    writer.end()
  }))
  try { await cleanupFixture(ids) } finally {
    await db.$disconnect()
    await Promise.all(logPaths.map((path) => unlink(path).catch(() => {})))
  }
}
