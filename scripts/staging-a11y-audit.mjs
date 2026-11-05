/**
 * Auditoria de acessibilidade das telas de condução da sessão.
 *
 * A auditoria anterior (`staging-display-browser.mjs`) cobre entrada, painel e
 * telão. Esta estende para o que a Mesa opera de fato: presença e quórum,
 * votação nos três estados, telão em viewport de TV e app do parlamentar em
 * viewport móvel. Também percorre check-in → abrir votação → votar → encerrar
 * só com teclado e registra a sequência de foco.
 *
 * Gate: zero violações `critical` e `serious` do axe por tela. Violações
 * `moderate`/`minor` não derrubam o roteiro — saem no JSON para entrar no
 * documento da etapa com justificativa.
 *
 * `--base-url` é obrigatório e não pode ser a porta do servidor de
 * desenvolvimento: o roteiro **grava** sessão, presença, votações e eventos de
 * auditoria. Use `scripts/test-a11y-audit.sh`, que sobe uma instância
 * descartável e passa o endereço.
 */
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const REGRAS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
const IMPEDITIVAS = new Set(['critical', 'serious'])
const SENHA = process.env.A11Y_PASSWORD || 'DemoLegis!2026'
const OPERADOR = process.env.A11Y_OPERATOR_EMAIL || 'marcos.vieira@vilanova.mg.leg.br'
const PARLAMENTAR = process.env.A11Y_MEMBER_EMAIL || 'carla.mendes@vilanova.mg.leg.br'
// `session.create` é de tenant_admin/legislative_admin; a condução é do operador.
const LEGISLATIVO = process.env.A11Y_LEGISLATIVE_EMAIL || 'paula.andrade@vilanova.mg.leg.br'

const argumentos = process.argv.slice(2)
function opcao(nome, padrao) {
  const indice = argumentos.indexOf(`--${nome}`)
  return indice >= 0 ? argumentos[indice + 1] : padrao
}
const informado = opcao('base-url', process.env.A11Y_BASE_URL)
if (!informado) {
  throw new Error(
    'Informe --base-url (ou A11Y_BASE_URL) apontando para uma instância descartável. ' +
      'Use scripts/test-a11y-audit.sh, que sobe uma e passa o endereço.',
  )
}
const base = informado.replace(/\/$/, '')
// O roteiro autentica e **escreve**: sessão, check-ins, votações e eventos de
// auditoria, que entram na cadeia de hash append-only. Apontar para a porta do
// `bun run dev` sujaria a base de desenvolvimento de forma irreversível.
if (/:3000(\/|$)/.test(base)) {
  throw new Error(
    `Recusado: ${base} é a porta do servidor de desenvolvimento. Este roteiro grava dados ` +
      'e só roda contra instância descartável.',
  )
}

/** Chromium do Playwright quando baixado; senão o do sistema. */
async function abrirNavegador() {
  const tentativas = [
    { rotulo: 'playwright', opcoes: { headless: true } },
    ...[process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']
      .filter(Boolean)
      .map((caminho) => ({ rotulo: caminho, opcoes: { headless: true, executablePath: caminho, args: ['--no-sandbox'] } })),
  ]
  const motivos = []
  for (const tentativa of tentativas) {
    try {
      return { navegador: await chromium.launch(tentativa.opcoes), origem: tentativa.rotulo }
    } catch (erro) {
      motivos.push(`${tentativa.rotulo}: ${String(erro.message).split('\n')[0]}`)
    }
  }
  throw new Error(
    'Nenhum Chromium disponível. Baixe os navegadores do Playwright (`bunx playwright install chromium`) ' +
      `ou aponte CHROMIUM_PATH para um binário existente. Tentativas: ${motivos.join(' · ')}`,
  )
}

async function esperar(condicao, rotulo, limite = 20000) {
  const fim = Date.now() + limite
  let ultimoErro = null
  while (Date.now() < fim) {
    try {
      if (await condicao()) return
    } catch (erro) {
      ultimoErro = erro
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Tempo esgotado: ${rotulo}${ultimoErro ? ` (${ultimoErro.message})` : ''}`)
}

const auditorias = []
const layout = []

async function auditar(pagina, rotulo, viewport) {
  const resultado = await new AxeBuilder({ page: pagina }).withTags(REGRAS).analyze()
  const impeditivas = resultado.violations.filter((v) => IMPEDITIVAS.has(v.impact))
  const registro = {
    tela: rotulo,
    viewport,
    regrasAprovadas: resultado.passes.length,
    regrasInconclusivas: resultado.incomplete.length,
    violacoesImpeditivas: impeditivas.map((v) => ({
      id: v.id, impacto: v.impact, alvos: v.nodes.map((n) => n.target),
    })),
    violacoesMenores: resultado.violations
      .filter((v) => !IMPEDITIVAS.has(v.impact))
      .map((v) => ({ id: v.id, impacto: v.impact, alvos: v.nodes.map((n) => n.target) })),
  }
  auditorias.push(registro)
  if (impeditivas.length) {
    throw new Error(`Acessibilidade ${rotulo}: ${JSON.stringify(registro.violacoesImpeditivas)}`)
  }
  return registro
}

/** Contexto autenticado por senha, já posicionado no módulo pedido. */
async function contextoAutenticado(navegador, { email, viewport, modulo, sessionId }) {
  const contexto = await navegador.newContext({ viewport })
  const resposta = await contexto.request.post(`${base}/api/v1/auth/login`, {
    data: { email, password: SENHA },
  })
  if (!resposta.ok()) throw new Error(`Login de ${email} falhou: ${resposta.status()} ${await resposta.text()}`)
  const corpo = await resposta.json()
  const actorId = corpo.actor?.id
  if (!actorId) throw new Error(`Login de ${email} não devolveu ator.`)

  await contexto.addInitScript(({ actorId, modulo, sessionId }) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({
      state: { actorId, activeModule: modulo, focusSessionId: sessionId ?? null },
      version: 0,
    }))
  }, { actorId, modulo, sessionId })

  const pagina = await contexto.newPage()
  await pagina.goto(base, { waitUntil: 'domcontentloaded' })
  await pagina.locator('main').waitFor()
  return { contexto, pagina, actorId, ator: corpo.actor }
}

const { navegador, origem } = await abrirNavegador()
let api = null
let sessionId = null
const teclado = []

try {
  // ─── Preparação pela API, como a Mesa faria pela tela ──────────────────────
  const contextoApi = await navegador.newContext()
  api = contextoApi.request
  const login = await api.post(`${base}/api/v1/auth/login`, { data: { email: OPERADOR, password: SENHA } })
  if (!login.ok()) throw new Error(`Login do operador falhou: ${login.status()} ${await login.text()}`)
  const operadorAtor = (await login.json()).actor

  const contextoLegislativo = await navegador.newContext()
  const prep = contextoLegislativo.request
  const loginLegislativo = await prep.post(`${base}/api/v1/auth/login`, {
    data: { email: LEGISLATIVO, password: SENHA },
  })
  if (!loginLegislativo.ok()) {
    throw new Error(`Login da direção legislativa falhou: ${loginLegislativo.status()} ${await loginLegislativo.text()}`)
  }

  const bootstrap = await (await api.get(`${base}/api/v1/bootstrap`)).json()
  const tenantSlug = bootstrap.tenant.slug

  // A marca da Câmara precisa caber na sidebar e o cabeçalho não pode começar
  // atrás dela. No móvel, a mesma identificação deve aparecer no menu aberto.
  const desktop = await contextoAutenticado(navegador, {
    email: OPERADOR, viewport: { width: 1366, height: 768 }, modulo: 'dashboard',
  })
  const nomeCasa = bootstrap.tenant.name
  const faixaCasa = desktop.pagina.locator('aside nav span[title]').filter({ hasText: nomeCasa })
  await faixaCasa.waitFor()
  const geometria = await desktop.pagina.evaluate((nome) => {
    const aside = document.querySelector('aside')
    const header = document.querySelector('header')
    const titulo = [...(header?.querySelectorAll('p') ?? [])].find((elemento) => elemento.textContent?.trim() === nome)
    const faixa = [...(aside?.querySelectorAll('span[title]') ?? [])].find((elemento) => elemento.getAttribute('title') === nome)
    if (!aside || !header || !titulo || !faixa) return null
    return {
      sidebarRight: aside.getBoundingClientRect().right,
      headerNameLeft: titulo.getBoundingClientRect().left,
      sidebarNameClipped: faixa.scrollHeight > faixa.clientHeight + 1 || faixa.scrollWidth > faixa.clientWidth + 1,
    }
  }, nomeCasa)
  if (!geometria || geometria.headerNameLeft < geometria.sidebarRight || geometria.sidebarNameClipped) {
    throw new Error(`Identificação da Câmara no desktop sobreposta ou cortada: ${JSON.stringify(geometria)}`)
  }
  layout.push({ viewport: '1366×768', ...geometria })
  await desktop.contexto.close()

  const mobile = await contextoAutenticado(navegador, {
    email: OPERADOR, viewport: { width: 390, height: 844 }, modulo: 'dashboard',
  })
  await mobile.pagina.getByRole('button', { name: 'Abrir menu' }).click()
  const nomeNoMenu = mobile.pagina.getByRole('navigation', { name: 'Módulos do sistema' }).getByText(nomeCasa, { exact: true })
  await nomeNoMenu.waitFor()
  if (!await nomeNoMenu.isVisible()) throw new Error('Nome da Câmara não está visível no menu móvel.')
  layout.push({ viewport: '390×844', menuInstitutionNameVisible: true })
  await mobile.contexto.close()

  const parlamentares = (await (await prep.get(`${base}/api/v1/parliamentarians`)).json()).parliamentarians
    .filter((p) => p.active)
  if (parlamentares.length < 3) throw new Error('Base sem parlamentares ativos suficientes para o ensaio.')
  const presidente = parlamentares[0]

  const agendada = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const criada = await prep.post(`${base}/api/v1/sessions`, {
    data: {
      type: 'ordinaria',
      scheduledAt: agendada,
      presidentId: presidente.id,
      secretaryName: 'Secretaria do ensaio',
      location: 'Plenário (ensaio de acessibilidade)',
      notes: 'Sessão sintética do ensaio de acessibilidade — não é ato oficial.',
    },
  })
  if (!criada.ok()) throw new Error(`Criação da sessão falhou: ${criada.status()} ${await criada.text()}`)
  let sessao = (await criada.json()).session
  sessionId = sessao.id

  async function transicao(acao, extra = {}) {
    const resposta = await api.post(`${base}/api/v1/sessions/${sessionId}/transition`, {
      data: { action: acao, version: sessao.version, ...extra },
    })
    if (!resposta.ok()) throw new Error(`Transição ${acao} falhou: ${resposta.status()} ${await resposta.text()}`)
    sessao = (await resposta.json()).session
    return sessao
  }

  await transicao('schedule')
  await transicao('open_checkin')

  // ─── 1. Presença: check-in e quórum ────────────────────────────────────────
  const mesa = await contextoAutenticado(navegador, {
    email: OPERADOR, viewport: { width: 1366, height: 768 }, modulo: 'plenary', sessionId,
  })
  await mesa.pagina.getByRole('tab', { name: 'Presença' }).click()
  await esperar(async () => (await mesa.pagina.getByText(/parlamentares$/i).count()) > 0, 'barra de quórum')
  await auditar(mesa.pagina, 'presença — check-in aberto, quórum insuficiente', '1366×768')

  // Percurso por teclado: check-in do primeiro parlamentar sem usar o mouse.
  const botaoCheckIn = mesa.pagina.getByRole('button', { name: `Registrar check-in — ${parlamentares[1].name}` })
  await botaoCheckIn.waitFor()
  await botaoCheckIn.focus()
  teclado.push({ passo: 'check-in', foco: await mesa.pagina.evaluate(() => document.activeElement?.getAttribute('aria-label')) })
  await mesa.pagina.keyboard.press('Enter')
  await esperar(async () => {
    const texto = await mesa.pagina.locator('body').innerText()
    return /1 presente/.test(texto)
  }, 'check-in por teclado refletido no quórum')

  // Os demais pela API, para alcançar o quórum sem ensaio manual longo.
  for (const membro of parlamentares.slice(2)) {
    const resposta = await api.post(`${base}/api/v1/sessions/${sessionId}/attendance`, {
      data: { parliamentarianId: membro.id, action: 'check_in', commandId: crypto.randomUUID() },
    })
    if (!resposta.ok()) throw new Error(`Check-in de ${membro.name} falhou: ${resposta.status()}`)
  }
  await mesa.pagina.reload({ waitUntil: 'domcontentloaded' })
  await mesa.pagina.getByRole('tab', { name: 'Presença' }).click()
  await esperar(async () => (await mesa.pagina.locator('body').innerText()).includes('presentes'), 'quórum alcançado')
  await auditar(mesa.pagina, 'presença — quórum alcançado', '1366×768')

  // ─── 2. Votação: aberta, parcial oculto e encerrada ────────────────────────
  await transicao('open_session')

  async function criarVotacao(pergunta, ocultarParcial) {
    const resposta = await api.post(`${base}/api/v1/sessions/${sessionId}/votings`, {
      data: { question: pergunta, mode: 'nominal', rule: 'maioria_simples', hidePartial: ocultarParcial },
    })
    if (!resposta.ok()) throw new Error(`Criação da votação falhou: ${resposta.status()} ${await resposta.text()}`)
    return (await resposta.json()).voting
  }

  const votacao = await criarVotacao('Ensaio de acessibilidade — aprova o parecer?', false)
  await mesa.pagina.reload({ waitUntil: 'domcontentloaded' })
  await mesa.pagina.getByRole('tab', { name: 'Votação' }).click()

  // Abertura por teclado.
  const abrir = mesa.pagina.getByRole('button', { name: 'Abrir votação' }).first()
  await abrir.waitFor()
  await abrir.focus()
  teclado.push({ passo: 'abrir votação', foco: await mesa.pagina.evaluate(() => document.activeElement?.textContent?.trim()) })
  await mesa.pagina.keyboard.press('Enter')
  await esperar(async () => (await mesa.pagina.getByRole('button', { name: 'Encerrar votação' }).count()) > 0, 'votação aberta')
  await auditar(mesa.pagina, 'votação aberta com parcial visível', '1366×768')

  // Voto por teclado.
  const votar = mesa.pagina.getByRole('button', { name: `Registrar voto Sim de ${parlamentares[1].name}` }).first()
  await votar.waitFor()
  await votar.focus()
  teclado.push({ passo: 'votar', foco: await mesa.pagina.evaluate(() => document.activeElement?.getAttribute('aria-label')) })
  await mesa.pagina.keyboard.press('Enter')
  await esperar(async () => (await mesa.pagina.locator('body').innerText()).includes('1 de'), 'voto registrado')

  // Encerramento por teclado, com confirmação no diálogo.
  const encerrar = mesa.pagina.getByRole('button', { name: 'Encerrar votação' }).first()
  await encerrar.focus()
  teclado.push({ passo: 'encerrar votação', foco: await mesa.pagina.evaluate(() => document.activeElement?.textContent?.trim()) })
  await mesa.pagina.keyboard.press('Enter')
  const confirmar = mesa.pagina.getByRole('button', { name: 'Encerrar e apurar' })
  await confirmar.waitFor()
  await confirmar.focus()
  teclado.push({ passo: 'confirmar apuração', foco: await mesa.pagina.evaluate(() => document.activeElement?.textContent?.trim()) })
  await mesa.pagina.keyboard.press('Enter')
  await esperar(async () => {
    const texto = (await mesa.pagina.locator('body').innerText()).toLowerCase()
    return texto.includes('aprovado') || texto.includes('rejeitado') || texto.includes('empate')
  }, 'resultado apurado')
  await auditar(mesa.pagina, 'votação encerrada com resultado', '1366×768')

  const oculta = await criarVotacao('Ensaio de acessibilidade — parcial oculto', true)
  const abertura = await api.post(`${base}/api/v1/votings/${oculta.id}/transition`, {
    data: { action: 'open', version: oculta.version },
  })
  if (!abertura.ok()) throw new Error(`Abertura da votação oculta falhou: ${abertura.status()} ${await abertura.text()}`)
  await mesa.pagina.reload({ waitUntil: 'domcontentloaded' })
  await mesa.pagina.getByRole('tab', { name: 'Votação' }).click()
  await esperar(async () => (await mesa.pagina.getByRole('button', { name: 'Encerrar votação' }).count()) > 0, 'votação oculta aberta')
  await auditar(mesa.pagina, 'votação aberta com parcial oculto', '1366×768')
  await mesa.contexto.close()

  // ─── 3. Telão em viewport de TV ────────────────────────────────────────────
  for (const [largura, altura] of [[1920, 1080], [3840, 2160]]) {
    const telao = await contextoAutenticado(navegador, {
      email: OPERADOR, viewport: { width: largura, height: altura }, modulo: 'display', sessionId,
    })
    await esperar(async () => (await telao.pagina.locator('body').innerText()).trim().length > 40, 'quadro do telão')
    await auditar(telao.pagina, `telão em viewport de TV`, `${largura}×${altura}`)
    await telao.contexto.close()
  }

  // ─── 4. App do parlamentar em viewport móvel ───────────────────────────────
  const app = await contextoAutenticado(navegador, {
    email: PARLAMENTAR, viewport: { width: 390, height: 844 }, modulo: 'pwa', sessionId,
  })
  await esperar(async () => (await app.pagina.locator('body').innerText()).trim().length > 40, 'app do parlamentar')
  await auditar(app.pagina, 'app do parlamentar', '390×844')
  await app.contexto.close()

  console.log(JSON.stringify({
    ok: true,
    sintetico: true,
    data: new Date().toISOString(),
    baseUrl: base,
    tenant: tenantSlug,
    navegador: origem,
    operador: operadorAtor.role,
    layout,
    telas: auditorias.length,
    sequenciaDeFoco: teclado,
    auditorias,
  }, null, 2))
  await contextoApi.close()
  await contextoLegislativo.close()
} finally {
  // O ensaio roda em base descartável (ver scripts/test-a11y-audit.sh): a
  // sessão sintética morre com o banco, nada é removido por aqui.
  await navegador.close()
}
