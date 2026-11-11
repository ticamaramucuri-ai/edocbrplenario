/** Local Playwright journey for the global search palette and Analytics CSV export. */
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const base = (process.env.SEARCH_ANALYTICS_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('SEARCH_ANALYTICS_BASE_URL é obrigatório.')
if (/:3000(\/|$)/.test(base)) throw new Error('Recusado: a jornada grava e exige instância descartável.')

const email = process.env.SEARCH_ANALYTICS_EMAIL || 'ana.ribeiro@vilanova.mg.leg.br'
const password = process.env.SEARCH_ANALYTICS_PASSWORD || 'DemoLegis!2026'
const token = randomUUID().replaceAll('-', '').slice(0, 9)
const ementa = `EnsaioPaleta${token}: institui rotina local de busca integrada.`
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
const prisma = new PrismaClient()
let csvPath = null

function check(condition, message) { if (!condition) throw new Error(message) }
async function json(response, label) {
  if (!response.ok()) throw new Error(`${label}: ${response.status()} ${await response.text()}`)
  return response.json()
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const login = await json(await context.request.post(`${base}/api/v1/auth/login`, { data: { email, password } }), 'Login')
  check(login.actor?.role === 'tenant_admin', 'O usuário de ensaio deve ser tenant_admin.')
  const bootstrap = await json(await context.request.get(`${base}/api/v1/bootstrap`), 'Bootstrap')
  const tenantId = bootstrap.tenant.id
  const currentYear = new Date().getUTCFullYear()
  const createdMatter = (await json(await context.request.post(`${base}/api/v1/matters`, { data: {
    type: 'projeto_de_lei', ementa, authors: [`Autoria de ensaio ${token}`], year: currentYear,
  } }), 'Cadastro da matéria de busca')).matter

  const parliamentarians = (await json(await context.request.get(`${base}/api/v1/parliamentarians`), 'Parlamentares')).parliamentarians.filter((member) => member.active)
  check(parliamentarians.length > 0, 'O seed precisa ter parlamentar ativo para formar o ranking anual.')
  const president = parliamentarians.find((member) => member.boardRole === 'presidente') || parliamentarians[0]
  const latest = await prisma.session.findFirst({
    where: { tenantId, year: currentYear }, orderBy: { number: 'desc' }, select: { number: true },
  })
  const scheduledAt = new Date(Date.UTC(currentYear, 0, 15, 18))
  const closedAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000)
  const session = await prisma.session.create({ data: {
    tenantId, number: (latest?.number ?? 0) + 1, year: currentYear, type: 'ordinaria',
    scheduledAt, openedAt: scheduledAt, closedAt, status: 'closed', official: false,
    presidentId: president.id, presidentName: president.name, location: 'Plenário sintético',
  } })
  await prisma.attendanceEvent.create({ data: {
    sessionId: session.id, parliamentarianId: president.id, kind: 'check_in', status: 'presente', source: 'operador',
  } })
  const overview = await json(await context.request.get(`${base}/api/v1/analytics/overview?year=${currentYear}`), 'Analytics anual')
  check(overview.attendanceRanking.some((row) => row.parliamentarianId === president.id && row.total > 0), 'A sessão sintética não habilitou o ranking anual.')

  await context.addInitScript((actorId) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'dashboard', focusSessionId: null }, version: 0 }))
  }, login.actor.id)
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Pesquisar (Ctrl+K)' }).click()
  const palette = page.getByRole('dialog', { name: 'Pesquisa unificada' })
  await palette.getByRole('combobox').fill(`EnsaioPaleta${token}`)
  const result = palette.getByRole('option', { name: new RegExp(`EnsaioPaleta${token}`) })
  await result.waitFor()
  check((await result.innerText()).includes(createdMatter.ementa), 'A paleta não exibiu a matéria retornada pela busca do servidor.')
  await result.click()
  await palette.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Matérias' }).waitFor()

  await page.getByRole('link', { name: 'Analytics' }).click()
  await page.getByRole('heading', { name: 'Analytics' }).waitFor()
  await page.getByRole('img', { name: 'Presença por parlamentar (percentual)' }).waitFor()
  await page.getByRole('button', { name: 'Exportar CSV' }).waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  const download = await downloadEvent
  const filename = `presencas-${currentYear}.csv`
  check(download.suggestedFilename() === filename, `Nome de CSV inesperado: ${download.suggestedFilename()}`)
  csvPath = join(tmpdir(), `edocbr-analytics-${token}.csv`)
  await download.saveAs(csvPath)
  const csv = await readFile(csvPath, 'utf8')
  check(csv.startsWith('\uFEFFParlamentar;Partido;Sessões presentes;Sessões realizadas;Presença (%)'), 'CSV sem BOM, cabeçalho ou separador esperado para Excel pt-BR.')
  check(csv.includes(president.name), 'CSV exportado não contém o parlamentar do ranking conferido pela API.')
  await page.getByText('CSV exportado').waitFor()

  console.log(JSON.stringify({ ok: true, synthetic: true, search: {
    query: `EnsaioPaleta${token}`, matterId: createdMatter.id, navigatedTo: 'matters',
  }, analytics: { year: currentYear, sessionsHeld: overview.kpis.sessionsHeld, csv: filename, includesRankingMember: true }, browser: 'Playwright Chromium' }, null, 2))
  await context.close()
} finally {
  if (csvPath) await unlink(csvPath).catch(() => {})
  await prisma.$disconnect()
  await browser.close()
}
