/**
 * Local browser journey for Landing Page and Institutional Login.
 * Validates /apresentacao, /login, /, Public Verifier, Onboarding Form, and Axe accessibility.
 */
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const options = process.argv.slice(2)
const baseAt = options.indexOf('--base-url')
const base = baseAt >= 0 ? options[baseAt + 1]?.replace(/\/$/, '') : process.env.LANDING_BASE_URL
if (!base) throw new Error('Informe --base-url para a instância descartável.')
if (/:3000(\/|$)/.test(base)) throw new Error('Recusado: este roteiro não pode usar o servidor de desenvolvimento.')

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function auditA11y(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    // Exclui regras visuais que dependem de fontes remotas completas em headless linux se houver
    .analyze()

  const criticalOrSerious = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  if (criticalOrSerious.length > 0) {
    throw new Error(
      `Violação de acessibilidade (${label}): ${JSON.stringify(
        criticalOrSerious.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })),
        })),
        null,
        2
      )}`
    )
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  })
  const page = await context.newPage()

  try {
    console.log(`[1/4] Testando rota raiz / com exploração limpa da Landing Page...`)
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })

    // A Landing Page deve estar visível DIRETAMENTE sem nenhum modal bloqueando
    const heroSection = page.locator('#hero')
    await heroSection.waitFor({ state: 'visible', timeout: 5000 })
    check(await heroSection.isVisible(), 'Seção #hero deve estar visível')
    check(await page.getByRole('link', { name: 'edocBR Plenário', exact: true }).first().isVisible(), 'A apresentação deve ter uma assinatura única edocBR Plenário')

    const modulosSection = page.locator('#modulos')
    check(await modulosSection.isVisible(), 'Seção #modulos deve estar visível')
    console.log('  ✓ Landing Page carregada diretamente e sem pop-up bloqueante')

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileMenu = page.getByRole('button', { name: 'Abrir menu' })
    await mobileMenu.click()
    await page.getByRole('link', { name: 'Funcionalidades', exact: true }).click()
    check(new URL(page.url()).hash === '#modulos', 'Menu móvel deve levar à seção de funcionalidades')
    await page.setViewportSize({ width: 1280, height: 800 })

    // Clicar em "Área Restrita" no header da Landing Page para abrir o modal institucional
    const loginHeaderBtn = page.getByRole('button', { name: /Área Restrita/i }).first()
    await loginHeaderBtn.click()

    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    check(await dialog.isVisible(), 'O modal institucional de login deve abrir após clique em Área Restrita')
    console.log('  ✓ Modal institucional de login exibido após acionamento')

    // Auditoria de acessibilidade no modal institucional
    await auditA11y(page, 'Modal institucional de login em /')
    console.log('  ✓ Acessibilidade do modal institucional aprovada (Axe WCAG 2.1 AA)')

    // Fechar modal institucional para prosseguir
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 5000 })
    console.log('  ✓ Modal institucional fechado via Escape')

    console.log(`[2/4] Testando rota dedicada /apresentacao...`)
    await page.goto(`${base}/apresentacao`, { waitUntil: 'domcontentloaded' })

    // Verificar barra de telemetria e seções
    const titleText = await page.textContent('h1')
    check(titleText?.includes('Sua sessão plenária'), 'Título principal deve explicar a jornada da sessão')
    console.log('  ✓ Título institucional carregado')

    // Testar FAQ interativo
    const firstFaqBtn = page.locator('#faq button').first()
    await firstFaqBtn.click()
    await page.waitForTimeout(300)
    const expanded = await firstFaqBtn.getAttribute('aria-expanded')
    check(expanded === 'true', 'FAQ item deve expandir após clique')
    console.log('  ✓ Accordion do FAQ interativo validado')

    // Testar Verificador Criptográfico
    console.log(`[3/4] Testando Verificador Criptográfico e Auto-Onboarding...`)
    const verifierInput = page.locator('#verificador input').first()
    await verifierInput.waitFor({ state: 'visible', timeout: 5000 })
    check((await verifierInput.inputValue()) === '', 'Verificador não deve sugerir código fictício como documento real')
    check(!(await page.locator('#verificador').getByText('VÁLIDO E ÍNTEGRO').count()), 'Verificador não deve mostrar validade antes da consulta')
    await verifierInput.fill(`INEXISTENTE-${randomUUID()}`)
    const verifyBtn = page.locator('#verificador button').first()
    const verifyResponsePromise = page.waitForResponse((res) => res.url().includes('/api/v1/public/verify?code='))
    await verifyBtn.click()
    const verifyResponse = await verifyResponsePromise
    check(verifyResponse.status() === 200, 'Consulta pública deve responder HTTP 200')
    check((await verifyResponse.json()).found === false, 'Código inexistente deve retornar found=false')
    await page.locator('#verificador').getByText('NÃO LOCALIZADO').waitFor({ state: 'visible' })
    console.log('  ✓ Código inexistente consultado e exibido como não localizado')

    // Testar Formulário de Onboarding
    const suffix = randomUUID().slice(0, 6)
    const chamberInput = page.locator('#onb-chamber')
    check((await chamberInput.inputValue()) === '', 'Formulário deve começar sem dados de uma Câmara fictícia')
    await chamberInput.fill(`Câmara Municipal de Teste ${suffix}`)

    const cityInput = page.locator('#onb-city')
    await cityInput.fill('Cidade Modelo')

    const ufInput = page.locator('#onb-uf')
    await ufInput.fill('MG')

    const emailInput = page.locator('#onb-email')
    await emailInput.fill(`teste-${suffix}@exemplo.leg.br`)

    // Verificar se o slug foi auto-preenchido
    const slugInput = page.locator('#onb-slug')
    const slugValue = await slugInput.inputValue()
    check(slugValue.length > 0, 'Slug deve ser gerado automaticamente pelo formulário')

    // Marcar consentimento LGPD
    const lgpdCheckbox = page.locator('input[type="checkbox"]').first()
    check(!(await lgpdCheckbox.isChecked()), 'Consentimento deve exigir escolha ativa')
    const submitBtn = page.locator('#onboarding button[type="submit"]').first()
    await submitBtn.click()
    await page.getByText('É necessário concordar com os termos de tratamento de dados').waitFor({ state: 'visible' })
    await lgpdCheckbox.check()

    // Submeter formulário
    const onboardingResponsePromise = page.waitForResponse((res) => res.url().includes('/api/v1/public/onboarding') && res.request().method() === 'POST')
    await submitBtn.click()
    const onboardingResponse = await onboardingResponsePromise
    check(onboardingResponse.status() === 201, `Pedido de demonstração deve responder HTTP 201, recebido ${onboardingResponse.status()}`)
    const onboardingBody = await onboardingResponse.json()
    check(onboardingBody.request?.status === 'pendente', 'Pedido deve aguardar análise humana')
    await page.getByRole('dialog', { name: /Pedido Registrado com Sucesso/i }).waitFor({ state: 'visible' })
    console.log('  ✓ Pedido de demonstração registrado como pendente')

    // Auditoria de acessibilidade na página de apresentação
    await auditA11y(page, 'Página /apresentacao')
    console.log('  ✓ Acessibilidade da página /apresentacao aprovada (Axe WCAG 2.1 AA)')

    console.log(`[4/4] Testando página dedicada de Login Institucional /login...`)
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })

    // Verificar estrutura Split Vault
    const vaultText = await page.textContent('aside')
    check(vaultText?.includes('Cofre') || vaultText?.includes('Segurança regimental'), 'Coluna do Cofre deve estar presente')

    const tenantBadge = await page.textContent('main')
    check(tenantBadge?.includes('Câmara Municipal'), 'Seletor de Câmara ativa deve estar presente')

    // Auditoria de acessibilidade no login institucional
    await auditA11y(page, 'Página /login')
    console.log('  ✓ Acessibilidade da página /login aprovada (Axe WCAG 2.1 AA)')

    console.log('\n======================================================')
    console.log('SUCESSO: Todas as jornadas da Landing Page e Login passaram!')
    console.log('======================================================\n')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('\nFALHA NO TESTE DA LANDING PAGE / LOGIN:')
  console.error(err)
  process.exit(1)
})
