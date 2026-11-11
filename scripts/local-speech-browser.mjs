/** Local Playwright journey for the plenary speech queue and timer. */
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'

const base = (process.env.SPEECH_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('SPEECH_BASE_URL é obrigatório.')
if (/:3000(\/|$)/.test(base)) throw new Error('Recusado: a jornada grava e exige instância descartável.')

const email = process.env.SPEECH_EMAIL || 'ana.ribeiro@vilanova.mg.leg.br'
const password = process.env.SPEECH_PASSWORD || 'DemoLegis!2026'
const token = randomUUID().slice(0, 8)
const externalSpeaker = `Oradora de ensaio ${token}`
const subject = `Pronunciamento sobre serviço público ${token}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })

function check(condition, message) { if (!condition) throw new Error(message) }
async function json(response, label) {
  if (!response.ok()) throw new Error(`${label}: ${response.status()} ${await response.text()}`)
  return response.json()
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const login = await json(await context.request.post(`${base}/api/v1/auth/login`, { data: { email, password } }), 'Login')
  const actorId = login.actor?.id
  check(actorId, 'Login não retornou usuário de ensaio.')
  const bootstrap = await json(await context.request.get(`${base}/api/v1/bootstrap`), 'Bootstrap')
  const parliamentarians = (await json(await context.request.get(`${base}/api/v1/parliamentarians`), 'Parlamentares')).parliamentarians.filter((member) => member.active)
  check(parliamentarians.length > 0, 'O seed precisa ter ao menos um parlamentar ativo para abrir a sessão.')
  const president = parliamentarians.find((member) => member.boardRole === 'presidente') || parliamentarians[0]
  const matters = (await json(await context.request.get(`${base}/api/v1/matters`), 'Matérias')).matters
  let matter = matters.find((item) => !['aprovado', 'rejeitado'].includes(item.status))
  if (!matter) {
    matter = (await json(await context.request.post(`${base}/api/v1/matters`, { data: {
      type: 'projeto_de_lei', ementa: `Matéria sintética para sessão de ensaio ${token}.`,
      authors: ['Autoria de ensaio'], regime: 'ordinario',
    } }), 'Cadastro de matéria')).matter
  }

  const scheduledAt = new Date(Date.now() + 30 * 86400_000).toISOString()
  const created = (await json(await context.request.post(`${base}/api/v1/sessions`, { data: {
    type: 'ordinaria', scheduledAt, presidentId: president.id, secretaryName: 'Secretaria de ensaio',
    location: 'Plenário de ensaio', notes: `Fluxo sintético de discursos ${token}.`, matterIds: [matter.id], official: false,
  } }), 'Criação da sessão')).session
  let version = created.version
  const transitionSession = async (action) => {
    const result = (await json(await context.request.post(`${base}/api/v1/sessions/${created.id}/transition`, { data: { action, version } }), `Transição ${action}`)).session
    version = result.version
    return result
  }
  await transitionSession('schedule')
  await transitionSession('open_checkin')
  for (const member of parliamentarians) {
    await json(await context.request.post(`${base}/api/v1/sessions/${created.id}/attendance`, { data: {
      parliamentarianId: member.id, action: 'check_in', commandId: randomUUID(),
    } }), `Check-in de ${member.name}`)
  }
  await transitionSession('open_session')

  // Two simultaneous telões consume public realtime updates for the active session.
  const displayContexts = await Promise.all([0, 1].map(async () => {
    const displayContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const displayLogin = await json(await displayContext.request.post(`${base}/api/v1/auth/login`, {
      data: { email, password },
    }), 'Login do telão')
    const displayActorId = displayLogin.actor?.id
    check(displayActorId && displayLogin.actor.role === 'tenant_admin', 'Ator do telão não autenticado como operador de ensaio.')
    await displayContext.addInitScript((id) => {
      localStorage.setItem('legis.actorId', id)
      localStorage.setItem('legis-app', JSON.stringify({ state: { actorId: id, activeModule: 'display', focusSessionId: null }, version: 0 }))
    }, displayActorId)
    const displayPage = await displayContext.newPage()
    displayPage.setDefaultTimeout(12_000)
    await displayPage.goto(base, { waitUntil: 'domcontentloaded' })
    try {
      await displayPage.getByRole('button', { name: 'Sair do telão e voltar à mesa do plenário' }).waitFor()
    } catch {
      throw new Error(`Telão não abriu; URL=${displayPage.url()}; localStorage=${JSON.stringify(await displayPage.evaluate(() => localStorage.getItem('legis-app')))}; body=${(await displayPage.locator('body').innerText()).slice(0, 1200)}`)
    }
    return { context: displayContext, page: displayPage }
  }))
  const displayCommand = async (action, profile) => {
    const response = await context.request.post(`${base}/api/v1/display/command`, {
      data: { sessionId: created.id, action, ...(profile ? { profile } : {}) },
    })
    if (!response.ok()) throw new Error(`Comando de telão ${action} falhou: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  await displayCommand('profile', 'boas_vindas')
  for (const display of displayContexts) {
    await display.page.getByRole('region', { name: 'Perfil de boas-vindas' }).waitFor()
    await display.page.getByText(created.presidentName, { exact: false }).waitFor()
  }
  await displayCommand('profile', 'presenca')
  for (const display of displayContexts) {
    await display.page.getByRole('region', { name: 'Perfil de presença' }).waitFor()
    await display.page.getByText('Quórum atingido', { exact: false }).waitFor()
  }
  const displayStateResponse = await context.request.get(`${base}/api/v1/display/command?sessionId=${created.id}`)
  const displayState = await json(displayStateResponse, 'Estado do telão')
  check(displayState.state?.manualProfile === 'presenca' && displayState.state.mode === 'live', 'Perfil de presença não ficou persistido no estado do telão.')
  await displayCommand('freeze')
  for (const display of displayContexts) await display.page.getByText('Tela congelada', { exact: false }).waitFor()
  await displayCommand('unfreeze')
  for (const display of displayContexts) await display.page.getByText('Tela congelada', { exact: false }).waitFor({ state: 'hidden' })

  await context.addInitScript(({ actorId, sessionId }) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'plenary', focusSessionId: sessionId }, version: 0 }))
  }, { actorId, sessionId: created.id })
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Discursos' }).click()
  await page.getByRole('button', { name: 'Inscrever orador' }).click()
  const dialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: 'Inscrever orador' })
  await dialog.getByRole('radio', { name: 'Convidado/Externo' }).click()
  await dialog.getByLabel('Nome do orador').fill(externalSpeaker)
  await dialog.getByLabel('Tipo de discurso').click()
  await page.getByRole('option', { name: 'Grande expediente' }).click()
  await dialog.getByLabel('Assunto').fill(subject)
  await dialog.getByLabel('Duração (s)').fill('120')
  await dialog.getByRole('button', { name: 'Inscrever na fila' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText(`Próximo orador: ${externalSpeaker}`).waitFor()

  const getSession = async () => json(await context.request.get(`${base}/api/v1/sessions/${created.id}`), 'Consulta da sessão')
  let detail = await getSession()
  let speech = detail.speeches.find((item) => item.speakerName === externalSpeaker)
  check(speech?.status === 'fila' && speech.plannedSeconds === 120 && speech.subject === subject, 'Inscrição visual não persistiu os dados da fala.')

  await page.getByRole('button', { name: 'Iniciar' }).click()
  await page.getByRole('timer').waitFor()
  await page.getByText('Falando', { exact: true }).waitFor()
  await page.waitForTimeout(1100)
  await page.getByRole('button', { name: 'Pausar' }).click()
  await page.getByText('Pausado', { exact: true }).waitFor()
  detail = await getSession()
  speech = detail.speeches.find((item) => item.id === speech.id)
  check(speech.status === 'pausado' && speech.elapsedSeconds >= 1, 'Pausa não persistiu o estado e o tempo acumulado.')

  await page.getByRole('button', { name: 'Retomar' }).click()
  await page.getByText('Falando', { exact: true }).waitFor()
  await page.getByRole('button', { name: '+1 min' }).click()
  await page.getByText('Tempo prorrogado em 1 minuto').waitFor()
  detail = await getSession()
  speech = detail.speeches.find((item) => item.id === speech.id)
  check(speech.status === 'falando' && speech.plannedSeconds === 180, 'Retomada ou prorrogação não persistiu.')

  await page.getByRole('button', { name: 'Encerrar', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Encerrar discurso' }).click()
  await page.getByText('Discurso encerrado').waitFor()
  await page.getByText('Discursos encerrados').waitFor()
  detail = await getSession()
  speech = detail.speeches.find((item) => item.id === speech.id)
  check(speech.status === 'encerrado' && speech.plannedSeconds === 180 && speech.elapsedSeconds >= 1, 'Encerramento ou duração persistida incorretamente.')

  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const memberLogin = await json(await memberContext.request.post(`${base}/api/v1/auth/login`, {
    data: { email: process.env.SPEECH_MEMBER_EMAIL || 'carla.mendes@vilanova.mg.leg.br', password },
  }), 'Login do parlamentar')
  check(memberLogin.actor?.role === 'parliamentarian' && memberLogin.actor.parliamentarianId, 'Usuário de ensaio não está vinculado ao perfil parlamentar.')
  await memberContext.addInitScript((actorId) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'pwa', focusSessionId: null }, version: 0 }))
  }, memberLogin.actor.id)
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(12_000)
  await memberPage.goto(base, { waitUntil: 'domcontentloaded' })
  await memberPage.getByRole('heading', { name: 'App do Parlamentar' }).waitFor()
  const memberState = await json(await memberContext.request.get(`${base}/api/v1/me/context`), 'Contexto do parlamentar')
  check(memberState.session?.id === created.id && memberState.session.status === 'open', 'PWA não apontou para a sessão aberta recém-preparada.')
  await memberPage.getByRole('button', { name: 'Pedir a palavra' }).click()
  const memberDialog = memberPage.locator('[data-slot="dialog-content"]').filter({ hasText: 'Pedir a palavra' })
  await memberDialog.getByLabel('Tipo de pronunciamento *').click()
  await memberPage.getByRole('option', { name: 'Grande expediente' }).click()
  const memberSubject = `Pedido PWA de palavra ${token}`
  await memberDialog.getByLabel('Assunto (opcional)').fill(memberSubject)
  await memberDialog.getByRole('button', { name: 'Entrar na fila' }).click()
  await memberDialog.waitFor({ state: 'hidden' })
  await memberPage.getByText('1º na fila').waitFor()
  const mobileLayout = await memberPage.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  check(mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1, `Tela móvel excede a largura disponível: ${JSON.stringify(mobileLayout)}`)
  const memberStateAfter = await json(await memberContext.request.get(`${base}/api/v1/me/context`), 'Contexto após pedido')
  check(memberStateAfter.speechQueue.mine?.subject === memberSubject && memberStateAfter.speechQueue.position === 1, 'PWA não mostrou o pedido persistido na posição correta.')
  detail = await getSession()
  const pwaSpeech = detail.speeches.find((item) => item.subject === memberSubject)
  check(pwaSpeech?.status === 'fila' && pwaSpeech.parliamentarianId === memberLogin.actor.parliamentarianId, 'Pedido PWA não persistiu o vínculo parlamentar na sessão.')

  console.log(JSON.stringify({ ok: true, synthetic: true, sessionId: created.id, speech: {
    speaker: speech.speakerName, kind: speech.kind, status: speech.status,
    plannedSeconds: speech.plannedSeconds, elapsedSeconds: speech.elapsedSeconds,
  }, parliamentarianPwa: { speaker: pwaSpeech.speakerName, status: pwaSpeech.status, position: memberStateAfter.speechQueue.position, viewport: mobileLayout },
  display: { screens: displayContexts.length, profileFanout: true, presenceQuorumVisible: true, freezeUnfreeze: true }, browser: 'Playwright Chromium' }, null, 2))
  for (const display of displayContexts) await display.context.close()
  await memberContext.close()
  await context.close()
} finally {
  await browser.close()
}
