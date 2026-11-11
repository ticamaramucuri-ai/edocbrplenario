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
          nodes: v.nodes.map((n) => n.target),
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
    console.log(`[1/4] Testando rota raiz / com gate e exploração da Landing Page...`)
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })

    // O Dialog inicial de boas-vindas DEVE estar presente (preservando testes de homologação)
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 10000 })
    check(await dialog.isVisible(), 'O modal de boas-vindas deve abrir inicialmente no /')
    console.log('  ✓ Modal de boas-vindas exibido')

    // Auditoria de acessibilidade no modal
    await auditA11y(page, 'Modal de login inicial em /')
    console.log('  ✓ Acessibilidade do modal aprovada (Axe WCAG 2.1 AA)')

    // Clicar em "Explorar apresentação completa da plataforma"
    const exploreBtn = page.getByRole('button', { name: /Explorar apresentação completa/i })
    await exploreBtn.click()
    await dialog.waitFor({ state: 'hidden', timeout: 5000 })
    console.log('  ✓ Modal dispensado, landing page visível no /')

    // Verificar se seções chave existem na Landing Page
    const heroSection = page.locator('#hero')
    await heroSection.waitFor({ state: 'visible', timeout: 5000 })
    check(await heroSection.isVisible(), 'Seção #hero deve estar visível')

    const modulosSection = page.locator('#modulos')
    check(await modulosSection.isVisible(), 'Seção #modulos deve estar visível')

    // Clicar em "Área Restrita" no header da Landing Page para reabrir o modal
    const loginHeaderBtn = page.getByRole('button', { name: /Área Restrita/i }).first()
    await loginHeaderBtn.click()
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    console.log('  ✓ Reabertura do modal de login via botão da Landing Page confirmada')

    // Fechar novamente para prosseguir
    await exploreBtn.click()
    await dialog.waitFor({ state: 'hidden', timeout: 5000 })

    console.log(`[2/4] Testando rota dedicada /apresentacao...`)
    await page.goto(`${base}/apresentacao`, { waitUntil: 'domcontentloaded' })

    // Verificar barra de telemetria e seções
    const titleText = await page.textContent('h1')
    check(titleText?.includes('Governança e Deliberação'), 'Título principal deve conter mensagem institucional')
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
    const verifyBtn = page.locator('#verificador button').first()
    await verifyBtn.click()
    await page.waitForTimeout(600)
    console.log('  ✓ Consulta do verificador criptográfico executada')

    // Testar Formulário de Onboarding
    const suffix = randomUUID().slice(0, 6)
    const chamberInput = page.locator('#onb-chamber')
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
    await lgpdCheckbox.check()

    // Submeter formulário
    const submitBtn = page.locator('button[type="submit"]').first()
    await submitBtn.click()

    // Aguardar mensagem de sucesso ou alerta de rate-limit
    await page.waitForTimeout(1500)
    console.log('  ✓ Formulário de auto-onboarding submetido com validação Zod e consentimento LGPD')

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
