/** Two real browser screens against the isolated PostgreSQL staging tenant. */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const root = new URL('..', import.meta.url).pathname
const config = `${root}/deploy/staging/.env`
const values = Object.fromEntries(readFileSync(config, 'utf8').split('\n')
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const base = `http://127.0.0.1:${values.STAGE_APP_PORT || '3100'}`
const mainPort = values.STAGE_REALTIME_PORT || '3103'
const peerPort = values.STAGE_REALTIME_PEER_PORT || '3104'
const pgEnv = { ...process.env, PGHOST: '127.0.0.1', PGPORT: values.STAGE_DB_PORT || '55432',
  PGUSER: 'edocbr_stage', PGDATABASE: 'edocbr_stage', PGPASSWORD: values.STAGE_DB_PASSWORD }
if (!values.STAGE_DB_PASSWORD || !values.STAGE_ADMIN_PASSWORD) throw new Error('Homologação sintética não configurada.')

function run(command, env = process.env) {
  const result = Bun.spawnSync(command, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`${command[0]} falhou: ${result.stderr.toString().slice(-700)}`)
  return result.stdout.toString().trim()
}
const query = (sql) => run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], pgEnv)
const compose = (...args) => run(['docker', 'compose', '--profile', 'fanout-lab', '--env-file', config,
  '-f', `${root}/deploy/staging/compose.yaml`, ...args])
const quote = (value) => `'${value.replaceAll("'", "''")}'`

async function until(check, label, timeout = 25000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { if (await check()) return } catch { /* transient recovery */ }
    await Bun.sleep(300)
  }
  throw new Error(`Tempo esgotado: ${label}`)
}

if (query('SELECT string_agg(slug, \',\' ORDER BY slug) FROM "Tenant"') !== 'staging-example') {
  throw new Error('Ensaio permitido somente na base com o tenant sintético exclusivo.')
}
if (query('SELECT count(*) FROM "Session" WHERE status IN (\'check_in\',\'open\',\'suspended\',\'resumed\')') !== '0') {
  throw new Error('Há sessão em andamento na homologação; ensaio recusado.')
}
const tenantId = query('SELECT id FROM "Tenant" WHERE slug=\'staging-example\'')
const suffix = randomBytes(8).toString('hex')
const firstId = `stage-display-a-${suffix}`
const secondId = `stage-display-b-${suffix}`
const firstName = `Presidente inicial ${suffix}`
const changedName = `Presidente alterado ${suffix}`
const secondName = `Próxima sessão ${suffix}`
const number = 800000 + Number.parseInt(suffix.slice(0, 5), 16)
const year = new Date().getUTCFullYear() + 12
let browser
let peerStarted = false
try {
  query(`INSERT INTO "Session" (id, "tenantId", number, year, type, "scheduledAt", status, official, "presidentName", notes, "createdAt", "updatedAt") VALUES
    (${quote(firstId)}, ${quote(tenantId)}, ${number}, ${year}, 'ordinaria', now() + interval '1 hour', 'scheduled', false, ${quote(firstName)}, 'Ensaio sintético de duas telas', now(), now()),
    (${quote(secondId)}, ${quote(tenantId)}, ${number + 1}, ${year}, 'ordinaria', now() + interval '2 hours', 'scheduled', false, ${quote(secondName)}, 'Ensaio sintético de troca de sessão', now(), now())`)
  const live = await fetch(`${base}/api/v1/public/live?tenant=staging-example`).then((r) => r.json())
  if (live.session?.id !== firstId) throw new Error('Sessão de ensaio não foi selecionada pelo telão.')

  peerStarted = true
  compose('up', '-d', '--no-build', 'realtime_peer')
  await until(async () => (await fetch(`http://127.0.0.1:${peerPort}/health`)).ok, 'segundo nó de tempo real')
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox'] })

  const audits = []
  async function audit(page, label) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    if (result.violations.length) {
      throw new Error(`Acessibilidade ${label}: ${JSON.stringify(result.violations.map((violation) => ({
        id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => node.target),
      })))}`)
    }
    audits.push({ label, passedRules: result.passes.length, incompleteRules: result.incomplete.length })
  }

  const guest = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const loginPage = await guest.newPage()
  await loginPage.goto(base, { waitUntil: 'domcontentloaded' })
  await loginPage.getByRole('dialog').waitFor()
  await audit(loginPage, 'entrada clara')
  await loginPage.evaluate(() => localStorage.setItem('theme', 'dark'))
  await loginPage.reload({ waitUntil: 'domcontentloaded' })
  await loginPage.getByRole('dialog').waitFor()
  await until(() => loginPage.evaluate(() => document.documentElement.classList.contains('dark')), 'tema escuro aplicado')
  await audit(loginPage, 'entrada escura')
  await guest.close()

  async function screen(realtimePort, activeModule = 'display') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const loginResponse = await context.request.post(`${base}/api/v1/auth/login`, {
      data: { email: 'stage-admin@example.invalid', password: values.STAGE_ADMIN_PASSWORD },
    })
    if (!loginResponse.ok()) throw new Error(`Login de ensaio falhou: ${loginResponse.status()}`)
    const login = await loginResponse.json()
    const actorId = login.actor?.id
    if (!actorId || login.actor.role !== 'tenant_admin') throw new Error('Ator sintético inválido.')
    await context.addInitScript(({ actorId, mainPort, realtimePort, activeModule }) => {
      localStorage.setItem('legis.actorId', actorId)
      localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule, focusSessionId: null }, version: 0 }))
      if (realtimePort !== mainPort) {
        const NativeWebSocket = window.WebSocket
        window.WebSocket = class extends NativeWebSocket {
          constructor(url, protocols) {
            super(String(url).replace(`:${mainPort}/`, `:${realtimePort}/`), protocols)
          }
        }
      }
    }, { actorId, mainPort, realtimePort, activeModule })
    const page = await context.newPage()
    const socketUrls = []
    page.on('websocket', (socket) => socketUrls.push(socket.url()))
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    if (activeModule === 'display') {
      await until(async () => (await page.locator('body').innerText()).includes(firstName), 'quadro inicial no navegador')
    } else {
      await page.locator('main').waitFor()
    }
    await until(() => socketUrls.some((url) => url.includes(`:${realtimePort}/`)), 'WebSocket no nó escolhido')
    return { context, page, socketUrls }
  }

  const dashboard = await screen(mainPort, 'dashboard')
  await audit(dashboard.page, 'painel do operador')
  await dashboard.context.close()

  // Force the welcome profile so the president name is observable on both screens.
  const operator = await browser.newContext()
  const login = await operator.request.post(`${base}/api/v1/auth/login`, {
    data: { email: 'stage-admin@example.invalid', password: values.STAGE_ADMIN_PASSWORD },
  })
  if (!login.ok()) throw new Error('Login do operador falhou.')
  async function command(action, profile) {
    const response = await operator.request.post(`${base}/api/v1/display/command`, {
      data: { sessionId: firstId, action, ...(profile ? { profile } : {}) },
    })
    if (!response.ok()) throw new Error(`Comando ${action} falhou: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  await command('profile', 'boas_vindas')
  const first = await screen(mainPort)
  const second = await screen(peerPort)
  await audit(first.page, 'telão de boas-vindas')
  await command('profile', 'presenca')
  try {
    await until(async () => (await first.page.locator('body').innerText()).toLowerCase().includes('parlamentares presentes'), 'perfil de presença')
  } catch (error) {
    const state = await fetch(`${base}/api/v1/public/live?tenant=staging-example`).then((r) => r.json())
    console.error(JSON.stringify({ phase: 'presenca', displayState: state.displayState,
      body: (await first.page.locator('body').innerText()).slice(0, 1000) }))
    throw error
  }
  await audit(first.page, 'telão de presença')
  await command('profile', 'pauta')
  await until(async () => (await first.page.locator('body').innerText()).toLowerCase().includes('ordem do dia'), 'perfil de pauta')
  await audit(first.page, 'telão de pauta')
  await command('profile', 'boas_vindas')
  await until(async () => (await first.page.locator('body').innerText()).includes(firstName), 'boas-vindas restauradas')
  await until(async () => (await second.page.locator('body').innerText()).includes(firstName), 'segunda tela em boas-vindas')
  await command('freeze')
  try {
    await until(async () => (await first.page.locator('body').innerText()).toLowerCase().includes('tela congelada'), 'congelamento da tela 1')
  } catch (error) {
    const state = await fetch(`${base}/api/v1/public/live?tenant=staging-example`).then((r) => r.json())
    console.error(JSON.stringify({ displayState: state.displayState, body: (await first.page.locator('body').innerText()).slice(0, 900), sockets: first.socketUrls }))
    throw error
  }
  await until(async () => (await second.page.locator('body').innerText()).toLowerCase().includes('tela congelada'), 'congelamento da tela 2')
  query(`UPDATE "Session" SET "presidentName"=${quote(changedName)}, "updatedAt"=now() WHERE id=${quote(firstId)}`)
  await second.context.setOffline(true)
  await Bun.sleep(1200)
  if ((await first.page.locator('body').innerText()).includes(changedName)) throw new Error('Tela 1 exibiu dado posterior ao congelamento.')
  const late = await screen(mainPort)
  if (!(await late.page.locator('body').innerText()).includes(firstName)) throw new Error('Tela nova perdeu o quadro congelado.')
  await second.context.setOffline(false)
  await second.page.reload({ waitUntil: 'domcontentloaded' })
  await until(async () => (await second.page.locator('body').innerText()).includes(firstName), 'reconstrução após queda')
  for (const item of [first, second, late]) {
    const text = await item.page.locator('body').innerText()
    if (!text.includes(firstName) || text.includes(changedName)) throw new Error('Telas divergiram do quadro congelado.')
  }

  // A new selected session must retire the old frozen state on every screen.
  query(`UPDATE "Session" SET status='closed', "closedAt"=now(), "updatedAt"=now() WHERE id=${quote(firstId)}`)
  let nextLabel = ''
  await until(async () => {
    const response = await fetch(`${base}/api/v1/public/live?tenant=staging-example`)
    if (!response.ok) return false
    const body = await response.json()
    if (body.session?.id !== secondId) return false
    nextLabel = body.session.label
    return true
  }, 'troca da sessão pública')
  for (const item of [first, second, late]) {
    await until(async () => {
      const text = await item.page.locator('body').innerText()
      return text.includes(nextLabel) && !text.toLowerCase().includes('tela congelada') && !text.includes(firstName)
    }, 'troca da sessão em cada tela', 20000)
  }
  await audit(first.page, 'telão de pauta após troca de sessão')
  await late.page.keyboard.press('Tab')
  const focused = await late.page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  if (focused !== 'Sair do telão e voltar à mesa do plenário') {
    throw new Error(`Saída do telão não recebeu foco por teclado: ${focused ?? 'sem foco'}`)
  }
  await late.page.keyboard.press('Enter')
  await until(async () => (await late.page.getByRole('button', { name: 'Sair do telão e voltar à mesa do plenário' }).count()) === 0,
    'saída do telão por teclado')
  console.log(JSON.stringify({ ok: true, synthetic: true, tenant: 'staging-example', screens: 3,
    realtimeNodes: 2, frozenFrameAfterMutation: true, offlineReconnect: true,
    lateScreenRestored: true, sessionSwitchClearedOldFrame: true,
    keyboardExit: true, accessibilityAudits: audits }))
  await operator.close()
} finally {
  if (browser) await browser.close()
  query(`DELETE FROM "OutboxEvent" WHERE "tenantId"=${quote(tenantId)} AND "aggregateId" IN (${quote(firstId)}, ${quote(secondId)})`)
  query(`DELETE FROM "DisplayState" WHERE "sessionId" IN (${quote(firstId)}, ${quote(secondId)})`)
  query(`DELETE FROM "Session" WHERE id IN (${quote(firstId)}, ${quote(secondId)})`)
  if (peerStarted) compose('stop', 'realtime_peer')
}
