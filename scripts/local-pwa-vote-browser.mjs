/** Local Playwright journey for parliamentary self check-in, voting and receipt. */
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'

const base = (process.env.PWA_VOTE_BASE_URL || '').replace(/\/$/, '')
if (!base) throw new Error('PWA_VOTE_BASE_URL é obrigatório.')
if (/:3000(\/|$)/.test(base)) throw new Error('Recusado: a jornada grava e exige instância descartável.')

const adminEmail = process.env.PWA_VOTE_ADMIN_EMAIL || 'ana.ribeiro@vilanova.mg.leg.br'
const memberEmail = process.env.PWA_VOTE_MEMBER_EMAIL || 'carla.mendes@vilanova.mg.leg.br'
const password = process.env.PWA_VOTE_PASSWORD || 'DemoLegis!2026'
const token = randomUUID().slice(0, 8)
const question = `Ensaio PWA ${token}: aprova o projeto de teste?`
const customQuestion = `Opções regimentais ${token}: como registrar a deliberação?`
const customOptions = [{ key: 'a_favor', label: 'A favor' }, { key: 'contra', label: 'Contra' }]
const subject = `Voto pelo aplicativo ${token}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })

function check(condition, message) { if (!condition) throw new Error(message) }
async function json(response, label) {
  if (!response.ok()) throw new Error(`${label}: ${response.status()} ${await response.text()}`)
  return response.json()
}

try {
  const admin = await browser.newContext()
  const adminLogin = await json(await admin.request.post(`${base}/api/v1/auth/login`, { data: { email: adminEmail, password } }), 'Login da Mesa')
  check(adminLogin.actor?.role === 'tenant_admin', 'O usuário de preparação precisa ser administrador fictício.')
  const tenant = (await json(await admin.request.get(`${base}/api/v1/bootstrap`), 'Bootstrap')).tenant
  const policyResponse = await admin.request.patch(`${base}/api/v1/tenants/${tenant.id}`, { data: {
    settings: { votingPoliciesByMatterType: {
      projeto_de_lei: { rule: 'maioria_simples', quorumMinimum: 7 },
      decreto_legislativo: { rule: 'maioria_simples', quorumMinimum: 7 },
      requerimento: { rule: 'maioria_simples', quorumMinimum: 7 },
      indicacao: { rule: 'maioria_simples', quorumMinimum: 7 },
      mocao: { rule: 'maioria_simples', quorumMinimum: 7 },
      emenda: { rule: 'maioria_simples', quorumMinimum: 7 },
    } },
  } })
  await json(policyResponse, 'Política regimental sintética')
  const officialConfiguration = await json(await admin.request.get(`${base}/api/v1/official-configuration`), 'Configuração oficial')
  check(officialConfiguration.ready, `Seed sem configuração institucional pronta: ${JSON.stringify(officialConfiguration.checks)}`)
  if (!officialConfiguration.approved) {
    const approval = await admin.request.post(`${base}/api/v1/official-configuration`, { data: {
      expectedSha256: officialConfiguration.snapshotSha256,
      approvalReference: `Ensaio descartável de voto ${token}`,
      acknowledged: true,
    } })
    await json(approval, 'Aprovação da configuração sintética')
  }
  const approvedConfiguration = await json(await admin.request.get(`${base}/api/v1/official-configuration`), 'Verificação da configuração oficial')
  check(approvedConfiguration.approved, 'Configuração sintética não ficou aprovada para a sessão oficial.')
  const parliamentarians = (await json(await admin.request.get(`${base}/api/v1/parliamentarians`), 'Parlamentares')).parliamentarians.filter((member) => member.active)
  check(parliamentarians.length >= 2, 'O seed precisa ter ao menos dois parlamentares ativos.')
  const president = parliamentarians.find((member) => member.boardRole === 'presidente') || parliamentarians[0]
  const members = (await json(await admin.request.get(`${base}/api/v1/matters`), 'Matérias')).matters
  let matter = members.find((item) => !['aprovado', 'rejeitado'].includes(item.status))
  if (!matter) matter = (await json(await admin.request.post(`${base}/api/v1/matters`, { data: {
    type: 'projeto_de_lei', ementa: `Matéria para ensaio PWA ${token}.`, authors: ['Autoria de ensaio'],
  } }), 'Matéria')).matter

  const scheduledAt = new Date(Date.now() + 30 * 86400_000).toISOString()
  const session = (await json(await admin.request.post(`${base}/api/v1/sessions`, { data: {
    type: 'ordinaria', scheduledAt, presidentId: president.id, secretaryName: 'Secretaria de ensaio',
    location: 'Plenário de ensaio', notes: `Jornada PWA sintética ${token}.`, matterIds: [matter.id], official: true,
  } }), 'Criação da sessão')).session
  let sessionVersion = session.version
  async function transitionSession(action) {
    const changed = (await json(await admin.request.post(`${base}/api/v1/sessions/${session.id}/transition`, {
      data: { action, version: sessionVersion },
    }), `Transição da sessão ${action}`)).session
    sessionVersion = changed.version
    return changed
  }
  await transitionSession('schedule')
  await transitionSession('open_checkin')

  const member = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const login = await json(await member.request.post(`${base}/api/v1/auth/login`, { data: { email: memberEmail, password } }), 'Login parlamentar')
  check(login.actor?.role === 'parliamentarian' && login.actor.parliamentarianId, 'Perfil parlamentar sem vínculo institucional no seed.')
  await member.addInitScript((actorId) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'pwa', focusSessionId: null }, version: 0 }))
  }, login.actor.id)
  const page = await member.newPage()
  page.setDefaultTimeout(12_000)
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'App do Parlamentar' }).waitFor()
  let personal = await json(await member.request.get(`${base}/api/v1/me/context`), 'Contexto do parlamentar')
  check(personal.session?.id === session.id && personal.session.status === 'check_in', 'PWA não selecionou a sessão em credenciamento.')
  const checkInResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/check-in') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Registrar minha presença na sessão atual' }).click()
  await json(await checkInResponse, 'Auto check-in pelo PWA')
  await page.getByText('Presença registrada', { exact: true }).first().waitFor()
  let detail = await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Presença da sessão')
  check(detail.attendance.some((row) => row.parliamentarianId === login.actor.parliamentarianId && row.status === 'presente'), 'Auto check-in do PWA não persistiu na sessão.')

  for (const parliamentarian of parliamentarians) {
    if (parliamentarian.id === login.actor.parliamentarianId) continue
    await json(await admin.request.post(`${base}/api/v1/sessions/${session.id}/attendance`, { data: {
      parliamentarianId: parliamentarian.id, action: 'check_in', commandId: randomUUID(),
    } }), `Check-in sintético de ${parliamentarian.name}`)
  }
  await transitionSession('open_session')
  await admin.addInitScript(({ actorId, sessionId }) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'plenary', focusSessionId: sessionId }, version: 0 }))
  }, { actorId: adminLogin.actor.id, sessionId: session.id })
  const mesaPage = await admin.newPage()
  mesaPage.setDefaultTimeout(12_000)
  await mesaPage.goto(base, { waitUntil: 'domcontentloaded' })
  await mesaPage.getByRole('tab', { name: 'Pauta' }).click()
  await mesaPage.getByRole('button', { name: 'Iniciar votação' }).first().click()
  const setupDialog = mesaPage.getByRole('dialog', { name: 'Configurar votação' })
  await setupDialog.getByLabel('Questão submetida à votação').fill(customQuestion)
  await setupDialog.getByRole('switch', { name: 'Usar opções regimentais customizadas' }).click()
  await setupDialog.getByLabel('Rótulo da opção 1').fill(customOptions[0].label)
  await setupDialog.getByLabel('Rótulo da opção 2').fill(customOptions[1].label)
  for (const option of customOptions) {
    check(await setupDialog.getByPlaceholder(option.key).count() === 1, `Chave slug da opção “${option.label}” não foi gerada.`)
  }
  await setupDialog.getByRole('button', { name: 'Criar votação' }).click()
  await setupDialog.waitFor({ state: 'hidden' })
  const detailAfterSetup = await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Votação criada pela UI')
  const createdVoting = detailAfterSetup.votings.find((voting) => voting.question === customQuestion)
  check(createdVoting?.status === 'ready' && createdVoting.options.length === customOptions.length
    && customOptions.every((option) => createdVoting.options.some((saved) => saved.key === option.key && saved.label === option.label)),
  'A votação customizada configurada pela Mesa não persistiu suas chaves/rótulos ou status pronta.')
  await mesaPage.getByRole('tab', { name: 'Votação' }).click()
  await mesaPage.getByRole('button', { name: 'Abrir votação' }).click()
  await mesaPage.getByText('Votação aberta', { exact: true }).waitFor()
  const detailAfterOpen = await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Votação aberta pela Mesa')
  const openedVoting = detailAfterOpen.votings.find((voting) => voting.id === createdVoting.id)
  check(openedVoting?.status === 'open', 'A Mesa não abriu a votação customizada pela interface.')

  await page.reload({ waitUntil: 'domcontentloaded' })
  personal = await json(await member.request.get(`${base}/api/v1/me/context`), 'Contexto da votação')
  check(personal.activeVoting?.voting.id === openedVoting.id && personal.activeVoting.eligible, 'PWA não exibiu votação aberta ou elegibilidade da parlamentar.')
  await page.getByText(customQuestion, { exact: true }).waitFor()
  await page.getByRole('button', { name: customOptions[0].label, exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await confirmation.getByText(`Seu voto: ${customOptions[0].label}`, { exact: true }).waitFor()
  const voteAttempts = []
  const retryableHttpFailures = []
  let firstServerStatus = null
  await page.route('**/api/v1/me/vote', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    voteAttempts.push(JSON.parse(route.request().postData() || '{}'))
    if (voteAttempts.length === 1) {
      retryableHttpFailures.push(429)
      return route.fulfill({ status: 429, contentType: 'application/problem+json', body: JSON.stringify({
        type: 'https://legis-saas/errors/rate-limited', title: 'Limite temporário', status: 429,
        detail: 'Aguarde e tente novamente.', code: 'RATE_LIMITED',
      }) })
    }
    if (voteAttempts.length === 2) {
      retryableHttpFailures.push(503)
      return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({
        type: 'https://legis-saas/errors/service-unavailable', title: 'Serviço indisponível', status: 503,
        detail: 'O registro do voto não pôde ser confirmado.', code: 'SERVICE_UNAVAILABLE',
      }) })
    }
    if (voteAttempts.length === 3) {
      const committedResponse = await route.fetch()
      firstServerStatus = committedResponse.status()
      return route.abort('failed')
    }
    return route.continue()
  })
  const throttledResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/vote') && response.status() === 429)
  await confirmation.getByRole('button', { name: 'Confirmar voto' }).click()
  const retryAlert = page.getByRole('alert').filter({ hasText: 'A resposta do voto não foi confirmada.' })
  await retryAlert.getByRole('button', { name: 'Tentar novamente' }).waitFor()
  await throttledResponse
  check(await page.getByRole('button', { name: customOptions[1].label, exact: true }).isDisabled(),
    'Após 429, a interface permitiu escolher outra opção em vez de retentar a mesma intenção.')
  const unavailableResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/vote') && response.status() === 503)
  await retryAlert.getByRole('button', { name: 'Tentar novamente' }).click()
  await unavailableResponse
  const droppedAcknowledgement = page.waitForEvent('requestfailed', (request) => request.url().endsWith('/api/v1/me/vote'))
  await retryAlert.getByRole('button', { name: 'Tentar novamente' }).click()
  await droppedAcknowledgement
  const idempotentResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/vote') && response.status() === 200)
  await retryAlert.getByRole('button', { name: 'Tentar novamente' }).click()
  await idempotentResponse
  await page.getByText('Voto registrado:', { exact: true }).waitFor()
  check(voteAttempts.length === 4 && voteAttempts.every((attempt) => attempt.commandId === voteAttempts[0].commandId
    && attempt.votingId === voteAttempts[0].votingId && attempt.value === voteAttempts[0].value),
  'A retentativa não reutilizou a mesma chave de idempotência e o mesmo voto.')
  check(firstServerStatus === 200, `O primeiro voto não foi confirmado pelo servidor antes da resposta ser descartada: ${firstServerStatus}.`)
  check(retryableHttpFailures.join(',') === '429,503', `O PWA não percorreu 429 e 503 como esperado: ${retryableHttpFailures}.`)
  await page.unroute('**/api/v1/me/vote')

  detail = await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Voto registrado')
  const recordedVoting = detail.votings.find((voting) => voting.id === openedVoting.id)
  const pwaVotes = recordedVoting?.votes.filter((vote) => vote.parliamentarianId === login.actor.parliamentarianId) ?? []
  check(pwaVotes.length === 1 && pwaVotes[0].value === customOptions[0].key, `A Mesa esperava um único voto PWA com chave customizada ${customOptions[0].key}, recebeu ${pwaVotes.length}.`)
  const currentVersion = recordedVoting.version
  await json(await admin.request.post(`${base}/api/v1/votings/${openedVoting.id}/transition`, { data: {
    action: 'close', version: currentVersion,
  } }), 'Encerramento da votação')

  const receipts = (await json(await member.request.get(`${base}/api/v1/me/receipts`), 'Recibos pessoais')).receipts
  const receipt = receipts.find((item) => item.question === customQuestion)
  check(receipt?.mode === 'nominal' && receipt.receiptCode, 'Encerramento não emitiu recibo verificável para a parlamentar.')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Recibos' }).click()
  await page.getByText(customQuestion, { exact: true }).waitFor()
  const code = await page.getByLabel('Código do recibo').filter({ hasText: receipt.receiptCode }).textContent()
  check(code?.trim() === receipt.receiptCode, 'Recibo pessoal não apareceu no histórico visual do PWA.')

  const mobileLayout = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }))
  check(mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1, `PWA excedeu a largura móvel: ${JSON.stringify(mobileLayout)}`)
  const finalVoting = (await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Apuração da votação')).votings.find((voting) => voting.id === openedVoting.id)
  check(finalVoting?.resultCounts?.custom?.[customOptions[0].key] === 1,
    `Apuração não contou a opção customizada ${customOptions[0].key}: ${JSON.stringify(finalVoting?.resultCounts)}`)

  const symbolicQuestion = `Contagem simbólica oficial ${token}`
  const symbolicVoting = (await json(await admin.request.post(`${base}/api/v1/sessions/${session.id}/votings`, { data: {
    question: symbolicQuestion, mode: 'simbolico', rule: 'maioria_simples',
    options: [{ key: 'a_favor', label: 'A favor' }, { key: 'contra', label: 'Contra' }],
  } }), 'Criação da votação simbólica')).voting
  await mesaPage.reload({ waitUntil: 'domcontentloaded' })
  await mesaPage.getByRole('tab', { name: 'Votação' }).click()
  await mesaPage.getByRole('button', { name: 'Abrir votação' }).click()
  await mesaPage.getByText('Votação aberta', { exact: true }).waitFor()

  async function plenaryIdentity(email, role, label, targetQuestion = symbolicQuestion) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const identity = await json(await context.request.post(`${base}/api/v1/auth/login`, { data: { email, password } }), `Login ${label}`)
    check(identity.actor?.role === role, `${label} precisa ser ${role}; recebido ${identity.actor?.role}.`)
    await context.addInitScript(({ actorId, sessionId }) => {
      localStorage.setItem('legis.actorId', actorId)
      localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'plenary', focusSessionId: sessionId }, version: 0 }))
    }, { actorId: identity.actor.id, sessionId: session.id })
    const identityPage = await context.newPage()
    identityPage.setDefaultTimeout(12_000)
    await identityPage.goto(base, { waitUntil: 'domcontentloaded' })
    await identityPage.getByRole('heading', { name: 'Mesa do Plenário' }).waitFor()
    await identityPage.getByRole('tab', { name: 'Votação' }).click()
    await identityPage.getByText(targetQuestion, { exact: true }).waitFor()
    return { context, page: identityPage, actor: identity.actor }
  }

  const clerk = await plenaryIdentity(
    process.env.PWA_VOTE_CLERK_EMAIL || 'marcos.vieira@vilanova.mg.leg.br', 'session_operator', 'Secretaria')
  await clerk.page.getByRole('button', { name: 'Conferir contagem' }).click()
  const tallyDialog = clerk.page.getByRole('dialog', { name: 'Encerrar votação simbólica' })
  await tallyDialog.getByLabel('A favor').fill('2')
  await tallyDialog.getByLabel('Contra').fill('1')
  await tallyDialog.getByRole('button', { name: 'Enviar para conferência' }).click()
  await tallyDialog.waitFor({ state: 'hidden' })
  await clerk.page.getByText(/Aguarda conferência independente/).waitFor()
  await clerk.page.getByText('A favor:', { exact: false }).waitFor()

  const chair = await plenaryIdentity(
    process.env.PWA_VOTE_CHAIR_EMAIL || 'roberto.nogueira@vilanova.mg.leg.br', 'presiding_officer', 'Presidência')
  await chair.page.getByRole('button', { name: 'Confirmar como segunda pessoa' }).click()
  await chair.page.getByText('Conferência simbólica atualizada', { exact: true }).waitFor()
  await chair.page.getByText(/Confirmada por Roberto Nogueira/).waitFor()
  const confirmedTally = await json(await chair.context.request.get(
    `${base}/api/v1/votings/${symbolicVoting.id}/symbolic-tally`), 'Conferência confirmada')
  check(confirmedTally.revisions[0]?.confirmedByName === 'Roberto Nogueira'
    && confirmedTally.revisions[0]?.counts.a_favor === 2 && confirmedTally.revisions[0]?.counts.contra === 1,
  'A conferência visual não persistiu identidade e contagem customizada esperadas.')
  await chair.page.getByRole('button', { name: 'Encerrar votação' }).click()
  await chair.page.getByText('Votação encerrada — resultado apurado', { exact: true }).waitFor()
  const finalSymbolic = (await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Resultado simbólico oficial'))
    .votings.find((voting) => voting.id === symbolicVoting.id)
  check(finalSymbolic?.resultStatus === 'aprovado' && finalSymbolic.resultCounts?.custom?.a_favor === 2
    && finalSymbolic.resultCounts?.custom?.contra === 1 && finalSymbolic.resultCounts?.naoRegistraram === parliamentarians.length - 3,
  `Fechamento visual não usou a revisão simbólica confirmada: ${JSON.stringify(finalSymbolic?.resultCounts)}`)
  await clerk.context.close()
  await chair.context.close()

  const tieQuestion = `Empate simbólico oficial ${token}`
  const tieOptions = [
    { key: 'a_favor', label: 'A favor' },
    { key: 'contra', label: 'Contra' },
    { key: 'adiar', label: 'Adiar' },
  ]
  const agendaItem = (await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Pauta para empate simbólico')).agenda[0]
  check(agendaItem?.id, 'Sessão oficial de ensaio precisa manter item de pauta para verificar o resumo visual do empate.')
  const tieVoting = (await json(await admin.request.post(`${base}/api/v1/sessions/${session.id}/votings`, { data: {
    agendaItemId: agendaItem.id, question: tieQuestion, mode: 'simbolico', rule: 'maioria_simples', options: tieOptions,
  } }), 'Criação da votação simbólica empatada')).voting
  await mesaPage.reload({ waitUntil: 'domcontentloaded' })
  await mesaPage.getByRole('tab', { name: 'Votação' }).click()
  await mesaPage.getByRole('button', { name: 'Abrir votação' }).click()
  await mesaPage.getByText('Votação aberta', { exact: true }).waitFor()

  const tieClerk = await plenaryIdentity(
    process.env.PWA_VOTE_CLERK_EMAIL || 'marcos.vieira@vilanova.mg.leg.br', 'session_operator', 'Secretaria para empate', tieQuestion)
  await tieClerk.page.getByRole('button', { name: 'Conferir contagem' }).click()
  const tieDialog = tieClerk.page.getByRole('dialog', { name: 'Encerrar votação simbólica' })
  await tieDialog.getByLabel('A favor').fill('2')
  await tieDialog.getByLabel('Contra').fill('2')
  await tieDialog.getByLabel('Adiar').fill('1')
  await tieDialog.getByRole('button', { name: 'Enviar para conferência' }).click()
  await tieDialog.waitFor({ state: 'hidden' })
  await tieClerk.page.getByText(/Aguarda conferência independente/).waitFor()
  for (const [label, count] of [['A favor', 2], ['Contra', 2], ['Adiar', 1]]) {
    await tieClerk.page.getByText(`${label}:`, { exact: false }).waitFor()
    await tieClerk.page.getByText(new RegExp(`${label}:\\s*${count}`)).waitFor()
  }

  const tieChair = await plenaryIdentity(
    process.env.PWA_VOTE_CHAIR_EMAIL || 'roberto.nogueira@vilanova.mg.leg.br', 'presiding_officer', 'Presidência para empate', tieQuestion)
  await tieChair.page.getByRole('button', { name: 'Confirmar como segunda pessoa' }).click()
  await tieChair.page.getByText('Conferência simbólica atualizada', { exact: true }).waitFor()
  await tieChair.page.getByText(/Confirmada por Roberto Nogueira/).waitFor()
  const confirmedTie = await json(await tieChair.context.request.get(
    `${base}/api/v1/votings/${tieVoting.id}/symbolic-tally`), 'Conferência do empate simbólico')
  check(confirmedTie.revisions[0]?.confirmedByName === 'Roberto Nogueira'
    && confirmedTie.revisions[0]?.counts.a_favor === 2 && confirmedTie.revisions[0]?.counts.contra === 2
    && confirmedTie.revisions[0]?.counts.adiar === 1,
  'A interface não apresentou a revisão empatada completa e confirmada pela segunda identidade.')
  await tieChair.page.getByRole('button', { name: 'Encerrar votação' }).click()
  await tieChair.page.getByText('Votação encerrada — resultado apurado', { exact: true }).waitFor()
  const tieDetail = await json(await admin.request.get(`${base}/api/v1/sessions/${session.id}`), 'Resultado final do empate simbólico')
  const finalTie = tieDetail.votings.find((voting) => voting.id === tieVoting.id)
  const expectedTieSummary = 'Empate entre as opções mais votadas (2 votos “A favor”, 2 votos “Contra”).'
  check(finalTie?.resultStatus === 'empate' && finalTie.resultCounts?.custom?.a_favor === 2
    && finalTie.resultCounts?.custom?.contra === 2 && finalTie.resultCounts?.custom?.adiar === 1,
  `A Mesa não encerrou a contagem simbólica como empate: ${JSON.stringify(finalTie?.resultCounts)}`)
  check(tieDetail.agenda.find((item) => item.id === agendaItem.id)?.resultSummary === expectedTieSummary,
    `Resumo da pauta não identificou somente as opções empatadas: ${JSON.stringify(tieDetail.agenda.find((item) => item.id === agendaItem.id)?.resultSummary)}`)
  await tieChair.page.getByRole('tab', { name: 'Pauta' }).click()
  await tieChair.page.getByText(expectedTieSummary, { exact: true }).waitFor()
  await tieClerk.context.close()
  await tieChair.context.close()

  console.log(JSON.stringify({ ok: true, synthetic: true, sessionId: session.id, checkIn: 'presente', customVoting: {
    question: customQuestion, options: customOptions, pwaLabel: customOptions[0].label, persistedValue: customOptions[0].key,
    countedVotes: finalVoting.resultCounts.custom[customOptions[0].key],
  }, vote: {
    value: customOptions[0].key, retryAttempts: voteAttempts.length, sameCommandId: voteAttempts.every((attempt) => attempt.commandId === voteAttempts[0].commandId),
    retryableHttpFailures, firstServerStatusBeforeResponseDrop: firstServerStatus, recordedVotes: pwaVotes.length,
    registeredByParliamentarianId: login.actor.parliamentarianId,
  }, symbolicTally: { mode: 'simbolico', customCounts: confirmedTally.revisions[0].counts,
    proposedBy: confirmedTally.revisions[0].proposedByName, confirmedBy: confirmedTally.revisions[0].confirmedByName,
    approved: finalSymbolic.resultStatus === 'aprovado', nonVoters: finalSymbolic.resultCounts.naoRegistraram, closedViaMesa: true },
  symbolicTie: { mode: 'simbolico', counts: confirmedTie.revisions[0].counts,
    confirmedBy: confirmedTie.revisions[0].confirmedByName, result: finalTie.resultStatus,
    agendaSummary: expectedTieSummary, closedViaMesa: true },
  receipt: { mode: receipt.mode, visibleInPwa: true, codeLength: receipt.receiptCode.length }, mobileLayout, browser: 'Playwright Chromium' }, null, 2))
  await member.close()
  await admin.close()
} finally {
  await browser.close()
}
