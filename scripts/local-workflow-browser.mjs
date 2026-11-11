/** Local browser journey for matter registration, protocol, proceeding and task workflows. */
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/lib/server/audit.ts'

const options = process.argv.slice(2)
const baseAt = options.indexOf('--base-url')
const base = baseAt >= 0 ? options[baseAt + 1]?.replace(/\/$/, '') : process.env.WORKFLOW_BASE_URL
if (!base) throw new Error('Informe --base-url para a instância descartável.')
if (/:3000(\/|$)/.test(base)) throw new Error('Recusado: este roteiro grava e não pode usar o servidor de desenvolvimento.')

const email = process.env.WORKFLOW_EMAIL || 'ana.ribeiro@vilanova.mg.leg.br'
const password = process.env.WORKFLOW_PASSWORD || 'DemoLegis!2026'
const suffix = randomUUID().slice(0, 8)
const ementa = `Teste visual de fluxo legislativo ${suffix}: institui protocolo e acompanhamento municipal.`
const relatedEmenta = `Matéria relacionada de ensaio ${suffix}: altera a política municipal de acompanhamento.`
const sender = `Remetente de ensaio ${suffix}`
const subject = `Protocolo para fluxo legislativo ${suffix}`
const taskTitle = `Prazo de parecer ${suffix}`
const versionText = `Texto integral da versão apresentada no ensaio ${suffix}, com alterações registradas.`
const attachmentName = `Parecer de ensaio ${suffix}.pdf`
const attachmentBytes = Buffer.from(`%PDF-1.4\nArquivo privado sintético ${suffix}\n%%EOF`)
const templateName = `Modelo de ata de ensaio ${suffix}`
const templateBodyV1 = `# Ata de {{camara}}\n\nCorpo inicial da ata ${suffix}.`
const templateBodyV2 = `# Ata revisada de {{camara}}\n\nTexto atualizado da ata ${suffix}.`
const reportYear = 2098
const reportSessionLabel = `Sessão de relatório ${suffix}`
const reportMemberName = `Presença de relatório ${suffix}`
const reportExpedienteTitle = `Comunicado de expediente ${suffix}`
const reportAgendaTitle = `Projeto de pauta ${suffix}`
const reportVotingQuestion = `Aprova a proposta de relatório ${suffix}?`
const pdfReviewDir = process.env.REPORT_PDF_REVIEW_DIR

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function printedText(page, fileName) {
  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true })
  await page.emulateMedia({ media: 'screen' })
  if (pdfReviewDir) {
    mkdirSync(pdfReviewDir, { recursive: true })
    writeFileSync(join(pdfReviewDir, fileName), pdf)
  }
  const text = execFileSync(process.env.PDFTOTEXT_PATH || 'pdftotext', ['-', '-'], { input: pdf, encoding: 'utf8' })
  const info = execFileSync(process.env.PDFINFO_PATH || 'pdfinfo', ['-'], { input: pdf, encoding: 'utf8' })
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0)
  const pageSize = info.match(/^Page size:\s+(.+)$/m)?.[1] ?? 'unknown'
  const orphanHeadings = text.split('\f').map((page) => page.trim()).filter((page) =>
    /(?:^|\n)\d+\.\s+[A-ZÀ-Ý][A-ZÀ-Ý\s]+\s*\n\s*Página\s+\d+\s+de\s+\d+\s*$/u.test(page))
  return { pdf, text, pages, pageSize, orphanHeadings }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const prisma = new PrismaClient()

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const login = await context.request.post(`${base}/api/v1/auth/login`, { data: { email, password } })
  check(login.ok(), `Login de ensaio falhou: ${login.status()} ${await login.text()}`)
  const actor = (await login.json()).actor
  check(actor?.role === 'tenant_admin', `Papel de ensaio inesperado: ${actor?.role}`)
  const bootstrapResponse = await context.request.get(`${base}/api/v1/bootstrap`)
  check(bootstrapResponse.ok(), `Bootstrap falhou: ${bootstrapResponse.status()}`)
  const tenant = (await bootstrapResponse.json()).tenant
  const existingSession = await prisma.session.findFirst({
    where: { tenantId: tenant.id, year: reportYear }, orderBy: { number: 'desc' }, select: { number: true },
  })
  const reportMember = await prisma.parliamentarian.create({ data: {
    tenantId: tenant.id, name: reportMemberName, party: 'ENSAIO', order: 900,
  } })
  const reportLegislature = await prisma.legislature.create({ data: {
    tenantId: tenant.id, number: 98, startYear: reportYear, endYear: reportYear + 3, current: false,
  } })
  await prisma.mandate.create({ data: {
    tenantId: tenant.id, parliamentarianId: reportMember.id, legislatureId: reportLegislature.id,
    startDate: new Date(`${reportYear}-01-01T00:00:00.000Z`),
  } })
  const reportScheduledAt = new Date(`${reportYear}-05-21T18:00:00.000Z`)
  const reportSession = await prisma.session.create({ data: {
    tenantId: tenant.id, number: (existingSession?.number ?? 0) + 1, year: reportYear,
    type: 'ordinaria', scheduledAt: reportScheduledAt,
    openedAt: new Date(reportScheduledAt.getTime() + 5 * 60_000),
    closedAt: new Date(reportScheduledAt.getTime() + 90 * 60_000),
    status: 'closed', official: false, presidentName: `Presidência ${suffix}`,
    secretaryName: `Secretaria ${suffix}`, location: reportSessionLabel,
  } })
  await prisma.attendanceEvent.create({ data: {
    sessionId: reportSession.id, parliamentarianId: reportMember.id,
    kind: 'check_in', status: 'presente', source: 'operador',
  } })
  await prisma.agendaItem.createMany({ data: [
    { sessionId: reportSession.id, order: 1, section: 'expediente', title: reportExpedienteTitle, status: 'pendente' },
    { sessionId: reportSession.id, order: 2, section: 'ordem_do_dia', title: reportAgendaTitle, status: 'aprovado', resultSummary: 'Aprovado por 1 voto.' },
  ] })
  const longExpedienteItems = Array.from({ length: 36 }, (_, index) => ({
    sessionId: reportSession.id, order: index + 3, section: 'expediente', status: 'pendente',
    title: `Registro extenso ${String(index + 1).padStart(2, '0')} ${'Documento parlamentar com conteúdo preservado para conferência de paginação e leitura. '.repeat(3)}MARCADOR-EXP-${index + 1}-${suffix}`,
  }))
  const longAgendaItems = Array.from({ length: 36 }, (_, index) => ({
    sessionId: reportSession.id, order: index + 3, section: 'ordem_do_dia', status: 'pendente',
    title: `Proposição extensa ${String(index + 1).padStart(2, '0')} ${'Texto legislativo sintético para verificar fluxo entre páginas sem perda de conteúdo. '.repeat(3)}MARCADOR-PAUTA-${index + 1}-${suffix}`,
  }))
  await prisma.agendaItem.createMany({ data: [...longExpedienteItems, ...longAgendaItems] })
  const reportAgendaItem = await prisma.agendaItem.findFirstOrThrow({
    where: { sessionId: reportSession.id, order: 2 }, select: { id: true },
  })
  await prisma.voting.create({ data: {
    sessionId: reportSession.id, agendaItemId: reportAgendaItem.id,
    question: reportVotingQuestion, mode: 'nominal', rule: 'maioria_simples', status: 'closed',
    openedAt: reportScheduledAt, closedAt: new Date(reportScheduledAt.getTime() + 10 * 60_000),
    presentAtOpen: 1, presentAtClose: 1, resultStatus: 'aprovado',
    resultCounts: JSON.stringify({ sim: 1, nao: 0, abstencoes: 0, naoRegistraram: 0, presentes: 1 }),
    resultDetail: JSON.stringify([{ parliamentarianId: reportMember.id, name: reportMemberName, value: 'sim' }]),
  } })
  const emptyReportSession = await prisma.session.create({ data: {
    tenantId: tenant.id, number: (existingSession?.number ?? 0) + 2, year: reportYear,
    type: 'ordinaria', scheduledAt: new Date(reportScheduledAt.getTime() + 24 * 60 * 60_000),
    openedAt: new Date(reportScheduledAt.getTime() + 24 * 60 * 60_000 + 5 * 60_000),
    closedAt: new Date(reportScheduledAt.getTime() + 24 * 60 * 60_000 + 90 * 60_000),
    status: 'closed', official: false, presidentName: `Presidência ${suffix}`,
    secretaryName: `Secretaria ${suffix}`, location: `Sessão sem pauta ${suffix}`,
  } })
  const reportResponse = await context.request.get(`${base}/api/v1/reports/session/${reportSession.id}`)
  check(reportResponse.ok(), `Consulta do espelho falhou: ${reportResponse.status()} ${await reportResponse.text()}`)
  const reportView = await reportResponse.json()
  const tenantAuditEvents = await prisma.auditEvent.findMany({
    where: { tenantId: tenant.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const auditChainCheck = verifyChain(tenantAuditEvents)
  check(auditChainCheck.valid && reportView.auditChain.valid,
    `Cadeia de auditoria inválida no relatório: ${JSON.stringify({ brokenAt: auditChainCheck.brokenAt, eventCount: tenantAuditEvents.length })}`)
  check(reportView.session.attendance.some((row) => row.name === reportMemberName && row.present),
    `Presença da fixture ausente no endpoint do espelho: ${JSON.stringify(reportView.session.attendance)}`)
  await context.addInitScript((actorId) => {
    localStorage.setItem('legis.actorId', actorId)
    localStorage.setItem('legis-app', JSON.stringify({ state: { actorId, activeModule: 'matters', focusSessionId: null }, version: 0 }))
    window.__edocPrintCalled = false
    window.print = () => { window.__edocPrintCalled = true }
  }, actor.id)
  const page = await context.newPage()
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Matérias' }).waitFor()

  await page.getByRole('button', { name: 'Nova matéria' }).click()
  const matterDialog = page.getByRole('dialog')
  await matterDialog.getByLabel('Ementa *').fill(ementa)
  await matterDialog.getByLabel('Autores *').fill(`Autora ${suffix}`)
  await matterDialog.getByLabel('Autores *').press('Enter')
  await matterDialog.getByRole('radio', { name: 'Urgência' }).click()
  await matterDialog.getByRole('button', { name: 'Cadastrar matéria' }).click()
  await matterDialog.waitFor({ state: 'hidden' })
  await page.getByText(ementa, { exact: false }).waitFor()

  const mattersResponse = await context.request.get(`${base}/api/v1/matters?search=${encodeURIComponent(ementa)}`)
  check(mattersResponse.ok(), `Consulta da matéria falhou: ${mattersResponse.status()}`)
  const createdMatter = (await mattersResponse.json()).matters.find((matter) => matter.ementa === ementa)
  check(createdMatter?.regime === 'urgencia' && createdMatter.authors.includes(`Autora ${suffix}`), 'Matéria criada pela UI não persistiu os dados esperados.')
  const relatedCreate = await context.request.post(`${base}/api/v1/matters`, { data: {
    type: 'projeto_de_lei', ementa: relatedEmenta, authors: [`Coautoria ${suffix}`], year: new Date().getUTCFullYear(),
  } })
  check(relatedCreate.ok(), `Cadastro da matéria-alvo sintética falhou: ${relatedCreate.status()}`)
  const relatedMatter = (await relatedCreate.json()).matter

  await page.getByRole('link', { name: 'Protocolo e Tramitação' }).click()
  await page.getByRole('heading', { name: 'Protocolo e Tramitação' }).waitFor()
  await page.getByRole('button', { name: 'Nova entrada' }).click()
  const protocolDialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: 'Nova entrada de protocolo' })
  await protocolDialog.getByLabel('Remetente *').fill(sender)
  await protocolDialog.getByLabel('Assunto *').fill(subject)
  await protocolDialog.getByLabel('Matéria vinculada').click()
  const matterOption = page.getByRole('option', { name: new RegExp(`${createdMatter.number}/${createdMatter.year}`) }).first()
  await matterOption.click()
  await protocolDialog.getByRole('button', { name: 'Registrar protocolo' }).click()
  await protocolDialog.waitFor({ state: 'hidden' })
  const protocolRow = page.getByRole('row').filter({ hasText: sender })
  await protocolRow.waitFor()
  check((await protocolRow.innerText()).includes('Recebido'), 'Protocolo não apareceu com estado recebido.')

  await protocolRow.getByRole('button', { name: 'Distribuir' }).click()
  const distributeDialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: 'Distribuir protocolo' })
  await distributeDialog.getByLabel('Matéria de destino').click()
  await page.getByRole('option', { name: new RegExp(`${createdMatter.number}/${createdMatter.year}`) }).last().click()
  await distributeDialog.getByRole('button', { name: 'Distribuir' }).click()
  await distributeDialog.waitFor({ state: 'hidden' })
  await protocolRow.getByText('Distribuído').waitFor()

  await page.getByRole('tab', { name: 'Em Tramitação' }).click()
  const matterRow = page.getByRole('row').filter({ hasText: ementa })
  await matterRow.waitFor()
  await matterRow.click()
  await page.getByRole('button', { name: 'Registrar andamento' }).click()
  const proceedingDialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: 'Registrar andamento' })
  await proceedingDialog.getByLabel('Ação *').click()
  await page.getByRole('option', { name: 'Inclusão em pauta' }).click()
  await proceedingDialog.getByLabel('Situação de destino *').click()
  await page.getByRole('option', { name: 'Incluída em pauta' }).click()
  await proceedingDialog.getByLabel('Observações').fill(`Protocolo ${subject} encaminhado.`)
  await proceedingDialog.getByRole('button', { name: 'Registrar andamento' }).click()
  await proceedingDialog.waitFor({ state: 'hidden' })
  await page.getByText('Incluída em pauta', { exact: false }).first().waitFor()

  const persistedMatter = await context.request.get(`${base}/api/v1/matters/${createdMatter.id}`)
  const matterDetail = await persistedMatter.json()
  check(matterDetail.matter.status === 'incluida_pauta' && matterDetail.proceedings.length === 1, 'Tramitação visual não persistiu estado e andamento.')

  await page.getByRole('button', { name: 'Nova versão' }).click()
  const versionDialog = page.getByRole('dialog', { name: 'Nova versão do texto' })
  await versionDialog.getByLabel('Texto integral *').fill(versionText)
  await versionDialog.getByLabel('Autor da versão').fill(`Relatoria ${suffix}`)
  await versionDialog.getByRole('button', { name: 'Registrar versão' }).click()
  await versionDialog.waitFor({ state: 'hidden' })
  await page.getByText(versionText, { exact: false }).waitFor()

  const relatedSection = page.getByRole('region', { name: 'Relacionamentos' })
  await relatedSection.getByRole('button', { name: 'Vincular matéria' }).click()
  const relatedDialog = page.getByRole('dialog', { name: 'Vincular matéria' })
  await relatedDialog.getByLabel('Tipo de vínculo *').click()
  await page.getByRole('option', { name: 'Emenda' }).click()
  await relatedDialog.getByLabel('Filtrar matérias para vincular').fill(suffix)
  await relatedDialog.getByLabel('Matéria-alvo *').click()
  const targetOptionTexts = await page.getByRole('option').allTextContents()
  check(targetOptionTexts.some((text) => text.includes(suffix)), `Matéria-alvo não apareceu na lista filtrada: ${JSON.stringify(targetOptionTexts.slice(0, 10))}`)
  await page.getByRole('option', { name: new RegExp(suffix) }).click()
  await relatedDialog.getByLabel('Notas (opcional)').fill(`Vínculo visual do ensaio ${suffix}.`)
  await relatedDialog.getByRole('button', { name: 'Vincular matéria' }).click()
  await relatedDialog.waitFor({ state: 'hidden' })
  await relatedSection.getByText('Emenda', { exact: true }).waitFor()
  await relatedSection.getByText(new RegExp(`${relatedMatter.number}/${relatedMatter.year}`)).first().waitFor()

  const versionsResponse = await context.request.get(`${base}/api/v1/matters/${createdMatter.id}/versions`)
  const versions = (await versionsResponse.json()).versions
  check(versions.length === 1 && versions[0].text === versionText && versions[0].authorName === `Relatoria ${suffix}`, 'A nova versão registrada pela UI não persistiu integralmente.')
  const relatedResponse = await context.request.get(`${base}/api/v1/matters/${createdMatter.id}/related`)
  const relatedRows = (await relatedResponse.json()).related
  check(relatedRows.length === 1 && relatedRows[0].matter.id === relatedMatter.id && relatedRows[0].kind === 'emenda', 'O vínculo criado pela UI não persistiu matéria-alvo e tipo esperados.')

  await page.getByRole('button', { name: 'Adicionar anexo' }).click()
  const attachmentDialog = page.getByRole('dialog', { name: 'Adicionar anexo' })
  await attachmentDialog.getByLabel('Arquivo PDF privado').setInputFiles({
    name: attachmentName, mimeType: 'application/pdf', buffer: attachmentBytes,
  })
  await attachmentDialog.getByLabel('Espécie').click()
  await page.getByRole('option', { name: 'Parecer' }).click()
  await attachmentDialog.getByRole('button', { name: 'Enviar PDF' }).click()
  await attachmentDialog.waitFor({ state: 'hidden' })
  const attachmentSection = page.getByRole('region', { name: 'Anexos' })
  await attachmentSection.getByText(attachmentName, { exact: true }).waitFor()
  const attachmentDownloadEvent = page.waitForEvent('download')
  await attachmentSection.getByRole('button', { name: 'Baixar' }).click()
  const attachmentDownload = await attachmentDownloadEvent
  check(attachmentDownload.suggestedFilename() === attachmentName, `Nome de download inesperado: ${attachmentDownload.suggestedFilename()}`)
  const downloadedStream = await attachmentDownload.createReadStream()
  const downloadedChunks = []
  for await (const chunk of downloadedStream) downloadedChunks.push(chunk)
  check(Buffer.concat(downloadedChunks).equals(attachmentBytes), 'Bytes baixados pela interface diferem do PDF enviado.')
  const attachmentListResponse = await context.request.get(`${base}/api/v1/matters/${createdMatter.id}/attachments`)
  const attachmentList = (await attachmentListResponse.json()).attachments
  check(attachmentList.length === 1 && attachmentList[0].name === attachmentName && attachmentList[0].kind === 'parecer', 'Metadados do anexo visual não persistiram como esperado.')

  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Prazos e Tarefas' }).waitFor()
  await page.getByRole('tab', { name: 'Prazos e Tarefas' }).click()
  await page.getByRole('button', { name: 'Nova tarefa' }).click()
  const taskDialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: 'Nova tarefa' })
  await taskDialog.getByLabel('Título *').fill(taskTitle)
  const due = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const dueLocal = new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  await taskDialog.getByLabel('Prazo *').fill(dueLocal)
  await taskDialog.getByLabel('Matéria vinculada').click()
  await page.getByRole('option', { name: new RegExp(`${createdMatter.number}/${createdMatter.year}`) }).last().click()
  await taskDialog.getByLabel('Responsável').fill(`Secretaria ${suffix}`)
  await taskDialog.getByRole('button', { name: 'Criar tarefa' }).click()
  await taskDialog.waitFor({ state: 'hidden' })
  const taskRow = page.getByRole('row').filter({ hasText: taskTitle })
  await taskRow.waitFor()
  await taskRow.getByRole('button', { name: 'Concluir' }).click()
  await taskRow.getByText('Concluída').waitFor()

  const tasksResponse = await context.request.get(`${base}/api/v1/tasks?status=concluida`)
  const tasks = (await tasksResponse.json()).tasks
  const persistedTask = tasks.find((task) => task.title === taskTitle)
  check(persistedTask?.status === 'concluida' && persistedTask.matterId === createdMatter.id, 'Tarefa visual não persistiu conclusão/vínculo.')

  await page.getByRole('link', { name: 'Modelos de Documento' }).click()
  await page.getByRole('heading', { name: 'Modelos de Documento' }).waitFor()
  await page.getByRole('button', { name: 'Novo modelo' }).click()
  const templateDialog = page.getByRole('dialog', { name: 'Novo modelo de documento' })
  await templateDialog.getByLabel('Nome (3 a 120 caracteres)').fill(templateName)
  await templateDialog.getByRole('combobox', { name: 'Tipo do modelo' }).click()
  await page.getByRole('option', { name: 'Ata de sessão' }).click()
  await templateDialog.getByLabel('Descrição (opcional, máx. 300)').fill(`Modelo de ata para ensaio ${suffix}.`)
  await templateDialog.getByLabel('Corpo do modelo em Markdown').fill(templateBodyV1)
  await templateDialog.getByLabel('Nota de mudança (opcional)').fill('Criação inicial do modelo sintético.')
  await templateDialog.getByRole('tab', { name: 'Preview' }).click()
  await templateDialog.getByText(`Corpo inicial da ata ${suffix}.`).waitFor()
  await templateDialog.getByRole('tab', { name: 'Editor' }).click()
  await templateDialog.getByRole('button', { name: 'Criar modelo (v1)' }).click()
  await templateDialog.waitFor({ state: 'hidden' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Modelos de Documento' }).click()
  await page.getByRole('heading', { name: 'Modelos de Documento' }).waitFor()
  const templateRow = page.getByRole('row').filter({ hasText: templateName })
  await templateRow.getByText('v1', { exact: true }).waitFor()
  const templatesResponse = await context.request.get(`${base}/api/v1/templates`)
  check(templatesResponse.ok(), `Listagem de modelos falhou: ${templatesResponse.status()}`)
  const createdTemplate = (await templatesResponse.json()).templates.find((template) => template.name === templateName)
  check(createdTemplate?.currentVersion === 1 && createdTemplate.kind === 'ata_sessao', 'Modelo criado pela UI não persistiu nome, tipo ou versão inicial.')

  await templateRow.getByRole('button', { name: `Ações do modelo ${templateName}` }).click()
  await page.getByRole('menuitem', { name: 'Preview' }).click()
  const templatePreview = page.getByRole('dialog', { name: new RegExp(templateName) })
  await templatePreview.getByRole('region', { name: 'Documento renderizado' }).getByText(`Corpo inicial da ata ${suffix}.`).waitFor()
  check(!(await templatePreview.getByRole('alert').count()), 'Preview deixou placeholders conhecidos sem resolução.')
  await page.keyboard.press('Escape')
  await templatePreview.waitFor({ state: 'hidden' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Modelos de Documento' }).click()
  await page.getByRole('heading', { name: 'Modelos de Documento' }).waitFor()

  await templateRow.getByRole('button', { name: `Ações do modelo ${templateName}` }).click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  const editTemplateDialog = page.getByRole('dialog', { name: new RegExp(`Editar modelo — ${templateName}`) })
  await editTemplateDialog.getByLabel('Corpo do modelo em Markdown').fill(templateBodyV2)
  const saveVersionButton = editTemplateDialog.getByRole('button', { name: 'Salvar nova versão' })
  check(await saveVersionButton.isDisabled(), 'A tela permitiu salvar versão sem nota de mudança obrigatória.')
  await editTemplateDialog.getByLabel(/Nota de mudança/).fill(`Revisão do texto ${suffix}.`)
  await saveVersionButton.click()
  await editTemplateDialog.waitFor({ state: 'hidden' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Modelos de Documento' }).click()
  await page.getByRole('heading', { name: 'Modelos de Documento' }).waitFor()
  await templateRow.getByText('v2', { exact: true }).waitFor()
  const templateDetailAfterEditResponse = await context.request.get(`${base}/api/v1/templates/${createdTemplate.id}`)
  const templateDetailAfterEdit = (await templateDetailAfterEditResponse.json()).template
  check(templateDetailAfterEdit.currentVersion === 2 && templateDetailAfterEdit.versions.length === 2
    && templateDetailAfterEdit.versions.some((version) => version.version === 1)
    && templateDetailAfterEdit.versions.some((version) => version.version === 2),
  `A edição não preservou as versões 1 e 2 em histórico append-only: ${JSON.stringify(templateDetailAfterEdit)}`)
  const templateV2RenderResponse = await context.request.post(`${base}/api/v1/templates/${createdTemplate.id}/render`, { data: {} })
  check(templateV2RenderResponse.ok() && (await templateV2RenderResponse.json()).rendered.includes(`Texto atualizado da ata ${suffix}.`), 'A versão 2 não renderizou seu corpo atual.')

  await templateRow.getByRole('button', { name: `Ações do modelo ${templateName}` }).click()
  await page.getByRole('menuitem', { name: 'Histórico' }).click()
  const historyDialog = page.getByRole('dialog', { name: new RegExp(`Histórico — ${templateName}`) })
  await historyDialog.getByText('v1', { exact: true }).waitFor()
  await historyDialog.getByRole('button', { name: 'Restaurar esta versão' }).click()
  const restoreDialog = page.getByRole('alertdialog')
  await restoreDialog.getByRole('button', { name: 'Restaurar' }).click()
  await historyDialog.getByText('v3', { exact: true }).waitFor()
  await restoreDialog.waitFor({ state: 'hidden' })
  const templateDetailAfterRestoreResponse = await context.request.get(`${base}/api/v1/templates/${createdTemplate.id}`)
  const templateDetailAfterRestore = (await templateDetailAfterRestoreResponse.json()).template
  check(templateDetailAfterRestore.currentVersion === 3 && templateDetailAfterRestore.versions.length === 3
    && templateDetailAfterRestore.versions.some((version) => version.version === 1)
    && templateDetailAfterRestore.versions.some((version) => version.version === 2)
    && templateDetailAfterRestore.versions.some((version) => version.version === 3),
  'Restaurar não criou uma terceira versão preservando o histórico anterior.')
  const templateV3RenderResponse = await context.request.post(`${base}/api/v1/templates/${createdTemplate.id}/render`, { data: {} })
  check(templateV3RenderResponse.ok() && (await templateV3RenderResponse.json()).rendered.includes(`Corpo inicial da ata ${suffix}.`), 'A versão restaurada não reutilizou o conteúdo da versão 1.')
  const deactivatedResponse = await context.request.patch(`${base}/api/v1/templates/${createdTemplate.id}`, { data: { action: 'deactivate' } })
  check(deactivatedResponse.ok() && !(await deactivatedResponse.json()).template.active, 'A desativação local não persistiu pelo endpoint.')
  const activatedResponse = await context.request.patch(`${base}/api/v1/templates/${createdTemplate.id}`, { data: { action: 'activate' } })
  check(activatedResponse.ok() && (await activatedResponse.json()).template.active, 'A reativação local não persistiu pelo endpoint.')
  const finalTemplateResponse = await context.request.get(`${base}/api/v1/templates/${createdTemplate.id}`)
  const finalTemplate = (await finalTemplateResponse.json()).template
  check(finalTemplate.active && finalTemplate.currentVersion === 3, 'Reativação alterou estado ou versão indevidamente.')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Relatórios' }).click()
  await page.getByRole('heading', { name: 'Relatórios' }).waitFor()
  const reportSessionSelector = page.getByRole('combobox', { name: 'Selecionar sessão para o relatório' })
  await reportSessionSelector.click()
  await page.getByRole('option', { name: new RegExp(`${reportSession.number}/${reportYear}`) }).click()
  const mirrorArticle = page.getByRole('article', { name: 'Espelho da sessão' })
  try {
    await mirrorArticle.getByText(reportMemberName, { exact: false }).waitFor({ timeout: 5000 })
  } catch {
    const sessionList = await context.request.get(`${base}/api/v1/sessions`)
    const sessionPayload = sessionList.ok() ? await sessionList.json() : await sessionList.text()
    throw new Error(`Presença não renderizada na UI. Sessão alvo=${reportSession.id}; lista=${JSON.stringify(sessionPayload).slice(0, 2500)}; artigo=${(await mirrorArticle.innerText()).slice(0, 1800)}`)
  }
  await mirrorArticle.getByText(reportSessionLabel, { exact: true }).waitFor()
  await mirrorArticle.getByText(reportAgendaTitle, { exact: false }).waitFor()
  await mirrorArticle.getByText(reportVotingQuestion, { exact: false }).waitFor()
  const mirrorExpedienteSection = mirrorArticle.getByRole('region', { name: '2. Expediente' })
  const mirrorOrderSection = mirrorArticle.getByRole('region', { name: '3. Ordem do Dia' })
  await mirrorExpedienteSection.getByText(reportExpedienteTitle, { exact: false }).waitFor()
  check(!(await mirrorOrderSection.innerText()).includes(reportExpedienteTitle), 'Item de expediente foi exibido indevidamente na ordem do dia.')
  const mirrorDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON' }).click()
  const mirrorDownload = await mirrorDownloadEvent
  check(mirrorDownload.suggestedFilename() === `espelho-sessao-${reportSession.number}-${reportYear}.json`, 'Nome do JSON do espelho inesperado.')
  const mirrorStream = await mirrorDownload.createReadStream()
  const mirrorChunks = []
  for await (const chunk of mirrorStream) mirrorChunks.push(chunk)
  const mirrorJson = Buffer.concat(mirrorChunks).toString('utf8')
  check(mirrorJson.includes(reportMemberName) && mirrorJson.includes(reportSessionLabel)
    && mirrorJson.includes(reportAgendaTitle) && mirrorJson.includes(reportVotingQuestion), 'O JSON exportado do espelho não contém sessão, presença, pauta e votação da fixture.')
  await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
  check(await page.evaluate(() => window.__edocPrintCalled === true), 'O botão de impressão do espelho não chamou window.print().')
  const mirrorPdf = await printedText(page, 'espelho-sessao.pdf')
  const mirrorPdfText = mirrorPdf.text
  check(mirrorPdfText.includes(reportMemberName) && mirrorPdfText.includes(reportSessionLabel)
    && mirrorPdfText.includes(reportAgendaTitle) && mirrorPdfText.includes(reportVotingQuestion), 'PDF do espelho não contém sessão, presença, pauta e votação da fixture.')
  check(!mirrorPdfText.includes('Exportar JSON') && !mirrorPdfText.includes('Imprimir / PDF'), 'PDF do espelho inclui controles que deveriam ficar ocultos na impressão.')
  check(mirrorPdf.pageSize.includes('(A4)') && mirrorPdfText.includes(`Página 1 de ${mirrorPdf.pages}`)
    && mirrorPdfText.includes(`Página ${mirrorPdf.pages} de ${mirrorPdf.pages}`), `PDF do espelho não está em A4 ou não tem paginação impressa (${mirrorPdf.pageSize}; ${mirrorPdf.pages} páginas).`)
  check(mirrorPdf.orphanHeadings.length === 0, `PDF do espelho contém cabeçalho sem conteúdo na página: ${mirrorPdf.orphanHeadings.join('; ')}`)
  check(mirrorPdf.pages >= 2 && mirrorPdfText.includes('MARCADOR-PAUTA-36') && mirrorPdfText.includes(suffix), `PDF do espelho não paginou o conteúdo longo até o último item (páginas=${mirrorPdf.pages}).`)

  await page.getByRole('tab', { name: 'Minuta de Ata' }).first().click()
  const ataSessionSelector = page.getByRole('combobox', { name: 'Selecionar sessão para a minuta de ata' })
  await ataSessionSelector.click()
  await page.getByRole('option', { name: new RegExp(`${reportSession.number}/${reportYear}`) }).click()
  await page.getByRole('button', { name: 'Visualizar minuta' }).click()
  const ataArticle = page.getByRole('article', { name: 'Minuta de ata' })
  await ataArticle.getByText(reportMemberName, { exact: false }).first().waitFor()
  await ataArticle.getByText(reportSessionLabel, { exact: false }).first().waitFor()
  await ataArticle.getByText('1. Abertura', { exact: false }).waitFor()
  await ataArticle.getByText(reportExpedienteTitle, { exact: false }).waitFor()
  await ataArticle.getByText(reportVotingQuestion, { exact: false }).waitFor()
  const ataJsonEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON' }).click()
  const ataDownload = await ataJsonEvent
  check(ataDownload.suggestedFilename() === `minuta-ata-${reportSession.number}-${reportYear}.json`, 'Nome do JSON da minuta inesperado.')
  const ataStream = await ataDownload.createReadStream()
  const ataChunks = []
  for await (const chunk of ataStream) ataChunks.push(chunk)
  const ataJson = JSON.parse(Buffer.concat(ataChunks).toString('utf8'))
  check(ataJson.ata.session.number === reportSession.number && ataJson.ata.attendanceSummary.present.includes(reportMemberName)
    && ataJson.ata.expediente.some((item) => item.title === reportExpedienteTitle)
    && ataJson.ata.votings.some((voting) => voting.question === reportVotingQuestion), 'JSON da minuta não preservou sessão, presença, expediente e votação da fixture.')
  await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
  check(await page.evaluate(() => window.__edocPrintCalled === true), 'O botão de impressão da minuta não chamou window.print().')
  const ataPdf = await printedText(page, 'minuta-ata.pdf')
  const ataPdfText = ataPdf.text
  const ataPdfNormalized = ataPdfText.replace(/\s+/g, '').toLocaleLowerCase('pt-BR')
  check(ataPdfText.includes(reportMemberName) && ataPdfText.includes(reportSessionLabel)
    && ataPdfText.includes(reportExpedienteTitle) && ataPdfText.includes(reportVotingQuestion)
    && ataPdfNormalized.includes('1.abertura'), 'PDF da minuta não contém sessão, presença, abertura, expediente e votação da ata.')
  check(!ataPdfText.includes('Exportar JSON') && !ataPdfText.includes('Imprimir / PDF'), 'PDF da minuta inclui controles que deveriam ficar ocultos na impressão.')
  check(ataPdf.pageSize.includes('(A4)') && ataPdfText.includes(`Página 1 de ${ataPdf.pages}`)
    && ataPdfText.includes(`Página ${ataPdf.pages} de ${ataPdf.pages}`), `PDF da minuta não está em A4 ou não tem paginação impressa (${ataPdf.pageSize}; ${ataPdf.pages} páginas).`)
  check(ataPdf.orphanHeadings.length === 0, `PDF da minuta contém cabeçalho sem conteúdo na página: ${ataPdf.orphanHeadings.join('; ')}`)
  check(ataPdf.pages >= 2 && ataPdfText.includes('MARCADOR-EXP-36') && ataPdfText.includes(suffix), `PDF da ata não paginou o conteúdo longo até o último item (páginas=${ataPdf.pages}).`)

  await page.getByRole('tab', { name: 'Espelho da Sessão' }).first().click()
  await reportSessionSelector.click()
  await page.getByRole('option', { name: new RegExp(`${emptyReportSession.number}/${reportYear}`) }).click()
  const emptyMirror = page.getByRole('article', { name: 'Espelho da sessão' })
  await emptyMirror.getByText('Sessão sem pauta publicada.').waitFor()
  await emptyMirror.getByText('Sem registros de presença.').waitFor()
  check(!(await emptyMirror.innerText()).includes('Nenhuma votação encerrada'), 'O espelho vazio mostrou uma votação inexistente.')
  await page.getByRole('tab', { name: 'Minuta de Ata' }).first().click()
  await ataSessionSelector.click()
  await page.getByRole('option', { name: new RegExp(`${emptyReportSession.number}/${reportYear}`) }).click()
  await page.getByRole('button', { name: 'Visualizar minuta' }).click()
  const emptyAta = page.getByRole('article', { name: 'Minuta de ata' })
  await emptyAta.getByText('Sem itens de expediente registrados.').waitFor()
  await emptyAta.getByText('Nenhuma votação encerrada com resultado nesta sessão.').waitFor()

  const sessionsErrorPage = await context.newPage()
  let sessionsAttempts = 0
  await sessionsErrorPage.route('**/api/v1/sessions', async (route) => {
    sessionsAttempts += 1
    if (sessionsAttempts <= 4) {
      await route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Serviço temporariamente indisponível' }) })
      return
    }
    await route.continue()
  })
  await sessionsErrorPage.goto(base, { waitUntil: 'domcontentloaded' })
  await sessionsErrorPage.getByRole('heading', { name: 'Matérias' }).waitFor()
  await sessionsErrorPage.getByRole('link', { name: 'Relatórios' }).click()
  try {
    await sessionsErrorPage.getByText('Não foi possível carregar as sessões').first().waitFor({ timeout: 6000 })
  } catch {
    throw new Error(`Falha da lista de sessões não apareceu; chamadas=${sessionsAttempts}; tela=${(await sessionsErrorPage.locator('main').innerText()).slice(0, 800)}`)
  }
  await sessionsErrorPage.getByRole('button', { name: 'Tentar novamente' }).last().click()
  await sessionsErrorPage.getByRole('article', { name: 'Espelho da sessão' }).waitFor()
  check(sessionsAttempts === 5, `Retry da lista de sessões fez ${sessionsAttempts} chamadas; esperado 5 (quatro falhas e recuperação).`)

  const emptyReportsPage = await context.newPage()
  await emptyReportsPage.route('**/api/v1/sessions', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }),
  }))
  await emptyReportsPage.goto(base, { waitUntil: 'domcontentloaded' })
  await emptyReportsPage.getByRole('heading', { name: 'Matérias' }).waitFor()
  await emptyReportsPage.getByRole('link', { name: 'Relatórios' }).click()
  await emptyReportsPage.getByText('Nenhuma sessão disponível').first().waitFor()
  await emptyReportsPage.getByRole('tab', { name: 'Minuta de Ata' }).first().click()
  await emptyReportsPage.getByText('Nenhuma sessão disponível').last().waitFor()

  await page.getByRole('link', { name: 'Matérias' }).click()
  let mirrorAttempts = 0
  let ataAttempts = 0
  const interceptedReportPaths = []
  await page.route('**/api/v1/reports/session/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    interceptedReportPaths.push(pathname)
    if (pathname.endsWith('/ata/signatures')) return route.continue()
    const isAta = pathname.endsWith('/ata')
    const attempt = isAta ? ++ataAttempts : ++mirrorAttempts
    if (attempt <= 2) {
      await route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Serviço temporariamente indisponível' }) })
      return
    }
    await route.continue()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Matérias' }).waitFor()
  await page.getByRole('link', { name: 'Relatórios' }).click()
  await page.getByText('Não foi possível carregar o espelho').waitFor()
  await page.getByRole('button', { name: 'Tentar novamente' }).last().click()
  await page.getByRole('article', { name: 'Espelho da sessão' }).waitFor()
  await page.getByRole('tab', { name: 'Minuta de Ata' }).first().click()
  await page.getByRole('button', { name: 'Visualizar minuta' }).click()
  await page.getByText('Não foi possível gerar a minuta').waitFor()
  await page.getByRole('button', { name: 'Tentar novamente' }).last().click()
  await page.getByRole('article', { name: 'Minuta de ata' }).waitFor()
  check(mirrorAttempts === 3 && ataAttempts === 3, `Contagem de chamadas de recuperação inesperada: espelho=${mirrorAttempts}; ata=${ataAttempts}`)

  console.log(JSON.stringify({
    ok: true,
    synthetic: true,
    module: 'Matérias + Protocolo e Tramitação',
    matter: { id: createdMatter.id, number: createdMatter.number, status: matterDetail.matter.status },
    protocol: { sender, distributed: true, matterLinked: true },
    proceeding: { count: matterDetail.proceedings.length, action: matterDetail.proceedings[0].action },
    version: { number: versions[0].version, author: versions[0].authorName, textPreserved: true },
    relation: { kind: relatedRows[0].kind, targetMatterId: relatedMatter.id, visibleInDrawer: true },
    attachment: { name: attachmentName, kind: attachmentList[0].kind, downloadedBytesMatch: true },
    task: { title: taskTitle, status: persistedTask.status, matterLinked: true },
    template: { id: createdTemplate.id, versions: templateDetailAfterRestore.versions.length, restoredV1AppendOnly: true, finalActive: finalTemplate.active },
    reports: { sessionId: reportSession.id, mirrorJsonContainsAttendanceAgendaVoting: true, ataJsonContainsAttendanceExpedienteVoting: true, printHandlers: 2, pdfsRenderedWithExpectedContent: true, agendaSectionsCorrectlySeparated: true, printControlsHidden: true, pageSize: [mirrorPdf.pageSize, ataPdf.pageSize], printedPageNumbersVerified: true, pdfPageCounts: [mirrorPdf.pages, ataPdf.pages], longContentPreserved: true, emptySessionsAndDocumentsHandled: true, sessions503RetryRecovered: true, reportAndAta503RetryRecovered: true, auditChain: { reportedValid: reportView.auditChain.valid, verifiedValid: auditChainCheck.valid, eventCount: tenantAuditEvents.length }, requestAttemptsIncludingRecovery: [sessionsAttempts, mirrorAttempts, ataAttempts] },
    browser: 'Playwright Chromium',
  }, null, 2))
  await context.close()
} finally {
  await prisma.$disconnect()
  await browser.close()
}
