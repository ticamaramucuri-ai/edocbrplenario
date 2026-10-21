/**
 * Seed — Legis SaaS
 * Dados demonstrativos FICTIONAIS (Câmara Municipal de Vila Nova/MG).
 * Execução: bun prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes, randomInt, randomUUID, scryptSync } from 'crypto'

import { computeReceipt } from '../src/lib/server/receipts'
import { computeDocHash, computeDocumentSignature } from '../src/lib/server/document-signatures'
import { computeTenantHealth } from '../src/lib/server/tenant-health'
import { createSessionNotice } from '../src/lib/server/session-notice'

const db = new PrismaClient()

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Mesmo formato de src/lib/server/session.ts (hashPassword). */
function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const DEMO_PASSWORD = 'DemoLegis!2026'

type AuditInput = {
  tenantId: string
  actorName: string
  actorRole: string
  action: string
  aggregateType: string
  aggregateId?: string
  summary: string
  before?: unknown
  after?: unknown
  justification?: string
  createdAt: Date
}

let lastHashByTenant = new Map<string, string | null>()

async function audit(input: AuditInput) {
  const prevHash = lastHashByTenant.get(input.tenantId) ?? null
  const body = JSON.stringify({
    tenantId: input.tenantId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId ?? null,
    summary: input.summary,
    beforeValue: input.before === undefined ? null : JSON.stringify(input.before),
    afterValue: input.after === undefined ? null : JSON.stringify(input.after),
    justification: input.justification ?? null,
    createdAt: input.createdAt.toISOString(),
  })
  const chainHash = sha256(`${prevHash ?? ''}|${body}`)
  lastHashByTenant.set(input.tenantId, chainHash)
  await db.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      action: input.action,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      summary: input.summary,
      beforeValue: input.before === undefined ? null : JSON.stringify(input.before),
      afterValue: input.after === undefined ? null : JSON.stringify(input.after),
      justification: input.justification,
      correlationId: randomUUID(),
      prevHash,
      chainHash,
      createdAt: input.createdAt,
    },
  })
}

async function main() {
  const YEAR = new Date().getFullYear()

  const institutionalTenant = await db.tenant.findFirst({
    where: { slug: { notIn: ['camara-vila-nova', 'camara-serra-azul'] } },
    select: { slug: true },
  })
  if (institutionalTenant) {
    throw new Error(`Seed demonstrativo bloqueado: a base contém o tenant institucional ${institutionalTenant.slug}. Use uma base descartável para demonstração.`)
  }

  console.log('Limpando base…')
  await db.outboxEvent.deleteMany()
  await db.auditEvent.deleteMany()
  await db.vote.deleteMany()
  // Onda 4 — recibos e opções de votação (explícito por clareza; FKs cascateariam)
  await db.voteReceipt.deleteMany()
  await db.votingOption.deleteMany()
  await db.voting.deleteMany()
  await db.speech.deleteMany()
  await db.attendanceEvent.deleteMany()
  await db.agendaItem.deleteMany()
  await db.session.deleteMany()
  // Fase 6/7 — webhooks, notificações e artefatos de IA
  await db.webhookDelivery.deleteMany()
  await db.webhookEndpoint.deleteMany()
  await db.notification.deleteMany()
  await db.aiArtifact.deleteMany()
  // Fase 5 — processo legislativo e estrutura institucional
  await db.legislativeTask.deleteMany()
  await db.protocolEntry.deleteMany()
  await db.matterAttachment.deleteMany()
  await db.matterVersion.deleteMany()
  await db.proceeding.deleteMany()
  await db.matterTypeConfig.deleteMany()
  await db.leave.deleteMany()
  await db.mandate.deleteMany()
  await db.committeeMeeting.deleteMany()
  await db.committeeMember.deleteMany()
  await db.committee.deleteMany()
  await db.boardPosition.deleteMany()
  await db.bloc.deleteMany()
  await db.party.deleteMany()
  // Onda 4 — relacionados/desfechos precisam sair antes das matérias (FK de RelatedMatter.to)
  await db.relatedMatter.deleteMany()
  await db.matterOutcome.deleteMany()
  await db.legislativeMatter.deleteMany()
  // Onda 4 — impersonações referenciam usuários (FK explícita)
  await db.supportImpersonation.deleteMany()
  await db.npsResponse.deleteMany() // Onda 5/F24 — antes dos usuários (FK)
  await db.user.deleteMany()
  await db.parliamentarian.deleteMany()
  await db.legislature.deleteMany()
  // Fase 8 — planos, assinaturas e migração (antes do tenant: FK)
  await db.migrationRun.deleteMany()
  await db.subscription.deleteMany()
  await db.plan.deleteMany()
  // Fases 9–11 — sessões de auth, faturas, publicações e audiências
  await db.authSession.deleteMany()
  await db.invoice.deleteMany()
  await db.hearingQuestion.deleteMany()
  await db.publicHearing.deleteMany()
  await db.publication.deleteMany()
  // Fase 14 — modelos de documento versionados
  await db.documentTemplateVersion.deleteMany()
  await db.documentTemplate.deleteMany()
  // Onda 4 — assinaturas do cidadão, jobs de exportação e alertas (FKs de tenant)
  await db.citizenSubscription.deleteMany()
  await db.exportJob.deleteMany()
  await db.platformAlert.deleteMany()
  // v0.12.0 — Planejamento e Roadmap (tasks antes das fases: FK)
  await db.roadmapTask.deleteMany()
  await db.roadmapPhase.deleteMany()
  // Onda 5 — modelos das Fases 21–24 (antes dos tenants)
  await db.scheduledJob.deleteMany()
  await db.documentSignature.deleteMany()
  await db.apiKey.deleteMany()
  await db.tenantHealthSnapshot.deleteMany()
  await db.onboardingRequest.deleteMany()
  await db.tenant.deleteMany()
  lastHashByTenant = new Map()

  const tenant = await db.tenant.create({
    data: {
      slug: 'camara-vila-nova',
      name: 'Câmara Municipal de Vila Nova',
      city: 'Vila Nova',
      uf: 'MG',
      plan: 'profissional',
      primaryColor: '#166a45',
      accentColor: '#b45309',
      timezone: 'America/Sao_Paulo',
      settings: JSON.stringify({
        quorumMinimum: 7,
        allowVoteChange: true,
        speechDefaultSeconds: 300,
        soundAlerts: true,
        hidePartialByDefault: false,
      }),
    },
  })
  const t = tenant.id

  const legislature = await db.legislature.create({
    data: { tenantId: t, number: 18, startYear: YEAR, endYear: YEAR + 3, current: true },
  })

  console.log('Criando parlamentares…')
  const parlData = [
    { name: 'Roberto Nogueira', party: 'PSD', bloc: 'Situação', boardRole: 'presidente', committee: 'Constituição e Justiça' },
    { name: 'Antônio Ferraz', party: 'MDB', bloc: 'Situação', boardRole: 'vice_presidente', committee: 'Finanças e Orçamento' },
    { name: 'Sandra Ribeiro', party: 'PSDB', bloc: 'Oposição', boardRole: 'primeiro_secretario', committee: 'Educação e Cultura' },
    { name: 'Carla Mendes', party: 'PT', bloc: 'Situação', boardRole: 'vereador', committee: 'Saúde e Assistência Social' },
    { name: 'João Bosco Lima', party: 'PP', bloc: 'Oposição', boardRole: 'vereador', committee: 'Obras e Serviços Públicos' },
    { name: 'Marta Cardoso', party: 'PDT', bloc: 'Situação', boardRole: 'vereador', committee: 'Meio Ambiente' },
    { name: 'Paulo Sérgio Alves', party: 'Republican', bloc: 'Oposição', boardRole: 'vereador', committee: 'Segurança Pública' },
    { name: 'Elaine Cristina Souza', party: 'Cidadania', bloc: 'Situação', boardRole: 'vereador', committee: 'Educação e Cultura' },
    { name: 'Geraldo Bezerra', party: 'PL', bloc: 'Oposição', boardRole: 'vereador', committee: 'Finanças e Orçamento' },
    { name: 'Fátima do Carmo', party: 'Podemos', bloc: 'Situação', boardRole: 'vereador', committee: 'Turismo e Esportes' },
    { name: 'Ricardo Tavares', party: 'Avante', bloc: 'Oposição', boardRole: 'vereador', committee: 'Obras e Serviços Públicos' },
    { name: 'Shirley Nascimento', party: 'Solidariedade', bloc: 'Situação', boardRole: 'vereador', committee: 'Saúde e Assistência Social' },
    { name: 'Douglas Pereira', party: 'PV', bloc: null, boardRole: 'vereador', committee: 'Meio Ambiente' },
  ]
  const parl: Record<string, { id: string }> = {}
  let order = 0
  for (const p of parlData) {
    const created = await db.parliamentarian.create({
      data: { tenantId: t, order: order++, ...p },
    })
    parl[p.name] = created
  }

  console.log('Criando usuários (atores demo)…')
  const users = [
    { name: 'Suporte Legis SaaS', email: 'suporte@legissaas.dev', role: 'platform_owner', jobTitle: 'Operação da plataforma' },
    { name: 'Ana Ribeiro', email: 'ana.ribeiro@vilanova.mg.leg.br', role: 'tenant_admin', jobTitle: 'Administradora da Câmara', tenantId: t },
    { name: 'Paula Andrade', email: 'paula.andrade@vilanova.mg.leg.br', role: 'legislative_admin', jobTitle: 'Diretora Legislativa', tenantId: t },
    { name: 'Marcos Vieira', email: 'marcos.vieira@vilanova.mg.leg.br', role: 'session_operator', jobTitle: 'Operador de Sessão', tenantId: t },
    { name: 'Roberto Nogueira', email: 'roberto.nogueira@vilanova.mg.leg.br', role: 'presiding_officer', jobTitle: 'Presidente da Câmara', tenantId: t, parliamentarianId: parl['Roberto Nogueira'].id },
    { name: 'Carla Mendes', email: 'carla.mendes@vilanova.mg.leg.br', role: 'parliamentarian', jobTitle: 'Vereadora', tenantId: t, parliamentarianId: parl['Carla Mendes'].id },
    { name: 'Helena Costa', email: 'helena.costa@tce.mg.gov.br', role: 'auditor', jobTitle: 'Auditora externa', tenantId: t },
  ]
  for (const u of users) {
    await db.user.create({ data: { ...u, tenantId: u.tenantId ?? null, parliamentarianId: u.parliamentarianId ?? null } })
  }

  console.log('Criando matérias…')
  const matters: Record<string, string> = {}
  const matterData = [
    { type: 'projeto_de_lei', number: 41, ementa: 'Institui o Programa Municipal de Agricultura Urbana e dá outras providências.', authors: ['Roberto Nogueira'], status: 'aprovado' },
    { type: 'projeto_de_lei', number: 42, ementa: 'Altera a Lei nº 2.314/2019 para atualizar o horário de funcionamento do comércio local.', authors: ['Geraldo Bezerra'], status: 'rejeitado' },
    { type: 'projeto_de_lei', number: 43, ementa: 'Cria o Dia Municipal de Conscientização sobre a Dislexia no Calendário Oficial do Município.', authors: ['Elaine Cristina Souza', 'Sandra Ribeiro'], status: 'incluida_pauta' },
    { type: 'projeto_de_lei', number: 44, ementa: 'Dispõe sobre a emissão de notas fiscais eletrônicas pelos prestadores de serviços do Município.', authors: ['Antônio Ferraz'], status: 'incluida_pauta', regime: 'urgencia' },
    { type: 'projeto_de_lei', number: 45, ementa: 'Institui a Semana Municipal de Combate ao Desperdício de Alimentos.', authors: ['Marta Cardoso'], status: 'em_tramitacao' },
    { type: 'projeto_de_lei', number: 46, ementa: 'Autoriza a concessão de auxílio-transporte aos servidores da educação básica.', authors: ['Executivo Municipal'], status: 'em_tramitacao' },
    { type: 'projeto_de_lei', number: 47, ementa: 'Cria o Cadastro Municipal de Pessoas com Deficiência e estabelece diretrizes de acessibilidade urbana.', authors: ['Shirley Nascimento', 'Carla Mendes'], status: 'em_tramitacao' },
    { type: 'projeto_de_lei', number: 48, ementa: 'Estabelece política de incentivo fiscal para empresas que concedam benefícios de creche aos empregados.', authors: ['João Bosco Lima'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 120, ementa: 'Requer homenagem com Voto de Congratulações à Brigada Militar de Vila Nova pelos 150 anos de serviços.', authors: ['Fátima do Carmo'], status: 'aprovado' },
    { type: 'requerimento', number: 121, ementa: 'Requer ao Executivo informações sobre o andamento das obras de pavimentação do Bairro São José.', authors: ['Ricardo Tavares'], status: 'incluida_pauta' },
    { type: 'requerimento', number: 122, ementa: 'Requer envio de cópia integral dos contratos de prestação de serviços de coleta de lixo celebrados no exercício.', authors: ['Geraldo Bezerra', 'Paulo Sérgio Alves'], status: 'incluida_pauta' },
    { type: 'requerimento', number: 123, ementa: 'Requer a realização de sessão solene em homenagem aos professores da rede municipal.', authors: ['Elaine Cristina Souza'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 124, ementa: 'Requer ao Executivo relatório detalhado dos investimentos em segurança escolar.', authors: ['Paulo Sérgio Alves'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 125, ementa: 'Requer informações sobre o número de vagas em creches municipais por bairro.', authors: ['Carla Mendes'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 126, ementa: 'Requer instalação de redutores de velocidade na Avenida das Flores.', authors: ['Shirley Nascimento'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 127, ementa: 'Requer audiência pública para debater o plano de saneamento básico.', authors: ['Douglas Pereira', 'Marta Cardoso'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 128, ementa: 'Requer do Executivo o calendário de manutenção das praças e parques municipais.', authors: ['Fátima do Carmo'], status: 'em_tramitacao' },
    { type: 'indicacao', number: 88, ementa: 'Indica ao Executivo a necessidade de poda de árvores na Rua das Acácias, no Centro.', authors: ['João Bosco Lima'], status: 'incluida_pauta' },
    { type: 'indicacao', number: 89, ementa: 'Indica a recuperação da iluminação pública no Bairro Jardim Primavera.', authors: ['Ricardo Tavares'], status: 'em_tramitacao' },
    { type: 'indicacao', number: 90, ementa: 'Indica a instalação de academia ao ar livre na Praça Central.', authors: ['Marta Cardoso'], status: 'em_tramitacao' },
    { type: 'indicacao', number: 91, ementa: 'Indica ao Executivo a ampliação do horário de atendimento da UBS do Bairro Operário.', authors: ['Carla Mendes'], status: 'em_tramitacao' },
    { type: 'mocao', number: 1, ementa: 'Moção de Apoio à campanha nacional de doação de sangue — Julho Vermelho.', authors: ['Sandra Ribeiro'], status: 'aprovado' },
    { type: 'mocao', number: 2, ementa: 'Moção de Pesar pelo falecimento do historiador e cidadão vilanovense Dr. Ademar Rezende.', authors: ['Antônio Ferraz'], status: 'incluida_pauta' },
    { type: 'mocao', number: 3, ementa: 'Moção de Congratulações à seleção municipal de futsal sub-17, campeã dos Jogos do Interior.', authors: ['Fátima do Carmo', 'Douglas Pereira'], status: 'em_tramitacao' },
    { type: 'decreto_legislativo', number: 7, ementa: 'Concede o Título de Cidadã Vilanovense à professora emérita Dra. Helena Vasconcelos.', authors: ['Roberto Nogueira', 'Elaine Cristina Souza'], status: 'em_tramitacao' },
    { type: 'projeto_de_lei', number: 49, ementa: 'Autoriza o reajuste das tarifas do transporte público coletivo urbano de Vila Nova e dá outras providências.', authors: ['João Bosco Lima'], status: 'vetado' },
    { type: 'emenda', number: 12, ementa: 'Emenda nº 12 ao PL 44/2026 — acrescenta parágrafo de isenção para microempreendedores individuais à emissão de notas fiscais eletrônicas.', authors: ['Marta Cardoso'], status: 'em_tramitacao' },
  ]
  for (const m of matterData) {
    const created = await db.legislativeMatter.create({
      data: { tenantId: t, ...m, year: YEAR, authors: JSON.stringify(m.authors) },
    })
    matters[`${m.type}-${m.number}/${YEAR}`] = created.id
  }

  const saoPauloOffset = -3 * 60 // UTC-3
  const now = new Date()
  const local = new Date(now.getTime() + saoPauloOffset * 60000)
  const at = (dayShift: number, h: number, m = 0) => {
    const d = new Date(local)
    d.setDate(d.getDate() + dayShift)
    d.setHours(h, m, 0, 0)
    return d
  }

  console.log('Criando sessões…')

  // ── Sessão 1 (histórica, encerrada) ──────────────────────────────
  const s1 = await db.session.create({
    data: {
      tenantId: t,
      number: 1,
      year: YEAR,
      type: 'ordinaria',
      scheduledAt: at(-7, 19),
      openedAt: at(-7, 19, 4),
      closedAt: at(-7, 21, 38),
      status: 'closed',
      presidentId: parl['Roberto Nogueira'].id,
      presidentName: 'Roberto Nogueira',
      secretaryName: 'Marcos Vieira',
      location: 'Plenário Anísio Teixeira',
      agendaPublished: true,
      version: 4,
    },
  })

  const agendaS1 = [
    { section: 'expediente', title: 'Abertura dos trabalhos e verificação de quórum pelo Presidente.', matterId: null as string | null, status: 'aprovado' },
    { section: 'expediente', title: 'Leitura e aprovação da Ata da Sessão anterior.', matterId: null, status: 'aprovado' },
    { section: 'expediente', title: 'Leitura de correspondências recebidas.', matterId: null, status: 'aprovado' },
    { section: 'ordem_do_dia', title: `REQ 120/${YEAR} — Voto de Congratulações aos 150 anos da Brigada Militar.`, matterId: matters[`requerimento-120/${YEAR}`], status: 'aprovado', resultSummary: 'Aprovado por 9 votos sim, 1 não e 1 abstenção.' },
    { section: 'ordem_do_dia', title: `PL 42/${YEAR} — Atualiza horário de funcionamento do comércio local.`, matterId: matters[`projeto_de_lei-42/${YEAR}`], status: 'rejeitado', resultSummary: 'Rejeitado por 5 votos sim e 6 votos não.' },
    { section: 'ordem_do_dia', title: `MO 1/${YEAR} — Moção de Apoio à campanha Julho Vermelho.`, matterId: matters[`mocao-1/${YEAR}`], status: 'aprovado', resultSummary: 'Aprovado por unanimidade em votação simbólica.' },
    { section: 'ordem_do_dia', title: `PL 41/${YEAR} — Programa Municipal de Agricultura Urbana.`, matterId: matters[`projeto_de_lei-41/${YEAR}`], status: 'aprovado', resultSummary: 'Aprovado em primeira discussão.' },
    { section: 'comunicacoes', title: 'Comunicações da Presidência.', matterId: null, status: 'aprovado' },
  ]
  let ord = 0
  for (const item of agendaS1) {
    await db.agendaItem.create({ data: { sessionId: s1.id, order: ord++, ...item } })
  }

  const presentS1 = parlData.filter((p) => p.name !== 'Douglas Pereira' && p.name !== 'Ricardo Tavares').map((p) => p.name)
  for (const name of presentS1) {
    await db.attendanceEvent.create({
      data: { sessionId: s1.id, parliamentarianId: parl[name].id, kind: 'check_in', status: 'presente', source: 'pwa', createdAt: at(-7, 18, 40) },
    })
  }
  await db.attendanceEvent.create({
    data: { sessionId: s1.id, parliamentarianId: parl['Douglas Pereira'].id, kind: 'mark', status: 'licenciado', source: 'operador', note: `Licença médica de 30 dias (Of. nº 112/${YEAR})`, createdAt: at(-7, 18, 45) },
  })
  await db.attendanceEvent.create({
    data: { sessionId: s1.id, parliamentarianId: parl['Ricardo Tavares'].id, kind: 'mark', status: 'ausente', source: 'operador', createdAt: at(-7, 19, 5) },
  })

  const v1 = await db.voting.create({
    data: {
      sessionId: s1.id,
      matterId: matters[`requerimento-120/${YEAR}`],
      question: `Requerimento nº 120/${YEAR} — Aprovação do Voto de Congratulações`,
      mode: 'nominal',
      status: 'closed',
      rule: 'maioria_simples',
      openedAt: at(-7, 20, 2),
      closedAt: at(-7, 20, 7),
      presentAtOpen: 11,
      quorumAtOpen: 7,
      presentAtClose: 11,
      quorumAtClose: 7,
      resultStatus: 'aprovado',
      resultCounts: JSON.stringify({ sim: 9, nao: 1, abstencoes: 1, naoRegistraram: 0, presentes: 11 }),
      resultDetail: JSON.stringify(
        presentS1.map((name, i) => ({
          parliamentarianId: parl[name].id,
          name,
          value: name === 'Paulo Sérgio Alves' ? 'nao' : name === 'Geraldo Bezerra' ? 'abstencao' : 'sim',
          order: i,
        }))
      ),
      version: 2,
    },
  })
  for (const name of presentS1) {
    const value = name === 'Paulo Sérgio Alves' ? 'nao' : name === 'Geraldo Bezerra' ? 'abstencao' : 'sim'
    await db.vote.create({
      data: { votingId: v1.id, parliamentarianId: parl[name].id, value, commandId: randomUUID(), receivedAt: at(-7, 20, 3) },
    })
  }

  const v2 = await db.voting.create({
    data: {
      sessionId: s1.id,
      matterId: matters[`projeto_de_lei-42/${YEAR}`],
      question: `Projeto de Lei nº 42/${YEAR} — Altera horário de funcionamento do comércio`,
      mode: 'nominal',
      status: 'closed',
      rule: 'maioria_simples',
      openedAt: at(-7, 20, 22),
      closedAt: at(-7, 20, 28),
      presentAtOpen: 11,
      quorumAtOpen: 7,
      presentAtClose: 11,
      quorumAtClose: 7,
      resultStatus: 'rejeitado',
      resultCounts: JSON.stringify({ sim: 5, nao: 6, abstencoes: 0, naoRegistraram: 0, presentes: 11 }),
      resultDetail: JSON.stringify(
        presentS1.map((name, i) => ({
          parliamentarianId: parl[name].id,
          name,
          value: ['Roberto Nogueira', 'Carla Mendes', 'Marta Cardoso', 'Elaine Cristina Souza', 'Shirley Nascimento'].includes(name) ? 'sim' : 'nao',
          order: i,
        }))
      ),
      version: 2,
    },
  })
  for (const name of presentS1) {
    const value = ['Roberto Nogueira', 'Carla Mendes', 'Marta Cardoso', 'Elaine Cristina Souza', 'Shirley Nascimento'].includes(name) ? 'sim' : 'nao'
    await db.vote.create({
      data: { votingId: v2.id, parliamentarianId: parl[name].id, value, commandId: randomUUID(), receivedAt: at(-7, 20, 23) },
    })
  }

  const v3 = await db.voting.create({
    data: {
      sessionId: s1.id,
      matterId: matters[`mocao-1/${YEAR}`],
      question: `Moção nº 1/${YEAR} — Moção de Apoio à campanha Julho Vermelho`,
      mode: 'simbolico',
      status: 'closed',
      rule: 'unanimidade',
      openedAt: at(-7, 20, 41),
      closedAt: at(-7, 20, 43),
      presentAtOpen: 11,
      quorumAtOpen: 7,
      presentAtClose: 11,
      quorumAtClose: 7,
      resultStatus: 'aprovado',
      resultCounts: JSON.stringify({ sim: 11, nao: 0, abstencoes: 0, naoRegistraram: 0, presentes: 11 }),
      version: 2,
    },
  })

  await db.speech.create({
    data: {
      sessionId: s1.id,
      parliamentarianId: parl['Sandra Ribeiro'].id,
      kind: 'grande_expediente',
      subject: 'Situação da merenda escolar na rede municipal',
      side: 'oposicao',
      status: 'encerrado',
      plannedSeconds: 300,
      elapsedSeconds: 287,
      startedAt: at(-7, 19, 25),
      finishedAt: at(-7, 19, 30),
      timerEvents: JSON.stringify([{ acao: 'iniciar', em: at(-7, 19, 25).toISOString() }, { acao: 'encerrar', em: at(-7, 19, 30).toISOString() }]),
    },
  })
  await db.speech.create({
    data: {
      sessionId: s1.id,
      parliamentarianId: parl['Carla Mendes'].id,
      kind: 'explicacoes_pessoais',
      subject: `Agradecimento à aprovação do PL 41/${YEAR}`,
      side: 'situacao',
      status: 'encerrado',
      plannedSeconds: 180,
      elapsedSeconds: 92,
      startedAt: at(-7, 21, 20),
      finishedAt: at(-7, 21, 22),
      timerEvents: JSON.stringify([{ acao: 'iniciar', em: at(-7, 21, 20).toISOString() }, { acao: 'encerrar', em: at(-7, 21, 22).toISOString() }]),
    },
  })

  console.log('Criando auditoria da sessão 1…')
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'session.created', aggregateType: 'session', aggregateId: s1.id, summary: 'Sessão criada com pauta de 8 itens.', createdAt: at(-8, 10) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'session.scheduled', aggregateType: 'session', aggregateId: s1.id, summary: 'Pauta publicada e sessão agendada.', before: { status: 'draft' }, after: { status: 'scheduled' }, createdAt: at(-8, 11) })
  await audit({ tenantId: t, actorName: 'Marcos Vieira', actorRole: 'session_operator', action: 'session.opened', aggregateType: 'session', aggregateId: s1.id, summary: 'Sessão aberta com quórum de 11 parlamentares.', before: { status: 'check_in' }, after: { status: 'open' }, createdAt: at(-7, 19, 4) })
  const votingAuditTrail: Array<{ vid: string; q: string; r: string; opened: Date; closed: Date }> = [
    { vid: v1.id, q: `REQ 120/${YEAR}`, r: 'aprovado', opened: at(-7, 20, 2), closed: at(-7, 20, 7) },
    { vid: v2.id, q: `PL 42/${YEAR}`, r: 'rejeitado', opened: at(-7, 20, 22), closed: at(-7, 20, 28) },
    { vid: v3.id, q: `MO 1/${YEAR}`, r: 'aprovado', opened: at(-7, 20, 41), closed: at(-7, 20, 43) },
  ]
  for (const { vid, q, r, opened, closed } of votingAuditTrail) {
    await audit({ tenantId: t, actorName: 'Marcos Vieira', actorRole: 'session_operator', action: 'voting.opened', aggregateType: 'voting', aggregateId: vid, summary: `Votação aberta: ${q}.`, after: { status: 'open' }, createdAt: opened })
    await audit({ tenantId: t, actorName: 'Marcos Vieira', actorRole: 'session_operator', action: 'voting.closed', aggregateType: 'voting', aggregateId: vid, summary: `Votação encerrada: ${q} — resultado ${r}.`, before: { status: 'open' }, after: { status: 'closed', resultStatus: r }, createdAt: closed })
  }
  await audit({ tenantId: t, actorName: 'Marcos Vieira', actorRole: 'session_operator', action: 'session.closed', aggregateType: 'session', aggregateId: s1.id, summary: 'Sessão encerrada às 21h38.', before: { status: 'open' }, after: { status: 'closed' }, createdAt: at(-7, 21, 38) })

  // ── Sessão 2 (de demonstração — hoje, 19h) ──────────────────────
  const s2 = await db.session.create({
    data: {
      tenantId: t,
      number: 2,
      year: YEAR,
      type: 'ordinaria',
      scheduledAt: at(0, 19),
      status: 'scheduled',
      presidentId: parl['Roberto Nogueira'].id,
      presidentName: 'Roberto Nogueira',
      secretaryName: 'Marcos Vieira',
      location: 'Plenário Anísio Teixeira',
      agendaPublished: true,
      version: 2,
    },
  })
  const agendaS2 = [
    { section: 'expediente', title: 'Abertura dos trabalhos e verificação de quórum.', matterId: null as string | null, status: 'pendente' },
    { section: 'expediente', title: 'Leitura e aprovação da Ata da 1ª Sessão Ordinária.', matterId: null, status: 'pendente' },
    { section: 'expediente', title: 'Leitura de correspondências e expediente cumprido.', matterId: null, status: 'pendente' },
    { section: 'ordem_do_dia', title: `PL 43/${YEAR} — Dia Municipal de Conscientização sobre a Dislexia.`, matterId: matters[`projeto_de_lei-43/${YEAR}`], status: 'pendente' },
    { section: 'ordem_do_dia', title: `PL 44/${YEAR} (urgência) — Notas fiscais eletrônicas de serviços.`, matterId: matters[`projeto_de_lei-44/${YEAR}`], status: 'pendente' },
    { section: 'ordem_do_dia', title: `REQ 121/${YEAR} — Informações sobre obras do Bairro São José.`, matterId: matters[`requerimento-121/${YEAR}`], status: 'pendente' },
    { section: 'ordem_do_dia', title: `REQ 122/${YEAR} — Cópia de contratos de coleta de lixo.`, matterId: matters[`requerimento-122/${YEAR}`], status: 'pendente' },
    { section: 'ordem_do_dia', title: `IND 88/${YEAR} — Poda de árvores na Rua das Acácias.`, matterId: matters[`indicacao-88/${YEAR}`], status: 'pendente' },
    { section: 'ordem_do_dia', title: `MO 2/${YEAR} — Moção de Pesar pelo falecimento de Dr. Ademar Rezende.`, matterId: matters[`mocao-2/${YEAR}`], status: 'pendente' },
    { section: 'comunicacoes', title: 'Comunicações da Presidência e encerramento.', matterId: null, status: 'pendente' },
  ]
  ord = 0
  for (const item of agendaS2) {
    await db.agendaItem.create({ data: { sessionId: s2.id, order: ord++, ...item } })
  }
  const agendaS2Rows = await db.agendaItem.findMany({ where: { sessionId: s2.id }, orderBy: { order: 'asc' } })
  const agendaS2Snapshot = agendaS2Rows.map((item) => ({ id: item.id, order: item.order, section: item.section, matterId: item.matterId, title: item.title, kind: item.kind, batchItems: item.batchItems, status: item.status }))
  const agendaS2Policy = { enabledSessionTypes: ['ordinaria', 'extraordinaria', 'solene', 'especial'], requireSecretaryForPublication: false, minimumAgendaMatters: 0, minimumNoticeHours: 0 }
  const agendaS2IssuedAt = at(-1, 9, 30)
  const agendaS2Notice = createSessionNotice({ tenant, session: s2, revision: 1, issuedAt: agendaS2IssuedAt, agenda: agendaS2Snapshot, policy: agendaS2Policy })
  await db.sessionAgendaRevision.create({ data: {
    tenantId: t, sessionId: s2.id, revision: 1,
    agendaJson: JSON.stringify(agendaS2Snapshot),
    policyJson: JSON.stringify(agendaS2Policy),
    noticeJson: agendaS2Notice.noticeJson,
    noticeSha256: agendaS2Notice.noticeSha256,
    createdAt: agendaS2IssuedAt,
  } })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'session.created', aggregateType: 'session', aggregateId: s2.id, summary: 'Sessão criada com pauta de 10 itens.', createdAt: at(-1, 9) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'session.scheduled', aggregateType: 'session', aggregateId: s2.id, summary: 'Pauta publicada e sessão agendada para hoje às 19h.', before: { status: 'draft' }, after: { status: 'scheduled' }, createdAt: at(-1, 9, 30) })

  // ── Sessão 3 (futura) ────────────────────────────────────────────
  const s3 = await db.session.create({
    data: {
      tenantId: t,
      number: 3,
      year: YEAR,
      type: 'ordinaria',
      scheduledAt: at(7, 19),
      status: 'draft',
      presidentId: parl['Roberto Nogueira'].id,
      presidentName: 'Roberto Nogueira',
      secretaryName: 'Marcos Vieira',
      location: 'Plenário Anísio Teixeira',
      agendaPublished: false,
      version: 1,
    },
  })
  await db.agendaItem.create({
    data: { sessionId: s3.id, order: 0, section: 'expediente', title: 'Abertura dos trabalhos.', status: 'pendente' },
  })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'session.created', aggregateType: 'session', aggregateId: s3.id, summary: 'Sessão criada (pauta em elaboração).', createdAt: at(-1, 9, 40) })

  // ════════════════════════════════════════════════════════════════
  // FASE 5 — Estrutura institucional & processo legislativo
  // ════════════════════════════════════════════════════════════════
  console.log('Fase 5: estrutura institucional…')
  const legStart = new Date(Date.UTC(YEAR, 0, 1, 12, 0, 0))

  // Partidos
  const partyData = [
    { acronym: 'PSD', name: 'Partido Social Democrático', number: 55 },
    { acronym: 'MDB', name: 'Movimento Democrático Brasileiro', number: 15 },
    { acronym: 'PSDB', name: 'Partido da Social Democracia Brasileira', number: 45 },
    { acronym: 'PT', name: 'Partido dos Trabalhadores', number: 13 },
    { acronym: 'PP', name: 'Partido Progressista', number: 11 },
    { acronym: 'PDT', name: 'Partido Democrático Trabalhista', number: 12 },
    { acronym: 'Republican', name: 'Republicanos', number: 10 },
    { acronym: 'Cidadania', name: 'Cidadania', number: 65 },
    { acronym: 'PL', name: 'Partido Liberal', number: 22 },
    { acronym: 'Podemos', name: 'Podemos', number: 19 },
    { acronym: 'Avante', name: 'Avante', number: 70 },
    { acronym: 'Solidariedade', name: 'Solidariedade', number: 77 },
    { acronym: 'PV', name: 'Partido Verde', number: 43 },
  ]
  for (const p of partyData) await db.party.create({ data: { tenantId: t, ...p } })

  // Blocos
  await db.bloc.create({ data: { tenantId: t, name: 'Situação', partyAcronyms: JSON.stringify(['PSD', 'MDB', 'PT', 'PDT', 'Cidadania', 'Podemos', 'Solidariedade']) } })
  await db.bloc.create({ data: { tenantId: t, name: 'Oposição', partyAcronyms: JSON.stringify(['PSDB', 'PP', 'Republican', 'PL', 'Avante']) } })

  // Mesa diretora (vigência = legislatura atual)
  const boardData: Array<{ role: string; name: string }> = [
    { role: 'presidente', name: 'Roberto Nogueira' },
    { role: 'vice_presidente', name: 'Antônio Ferraz' },
    { role: 'primeiro_secretario', name: 'Sandra Ribeiro' },
  ]
  for (const b of boardData) {
    await db.boardPosition.create({ data: { tenantId: t, legislatureId: legislature.id, role: b.role, parliamentarianId: parl[b.name].id, startDate: legStart } })
  }

  // Comissões + membros + reuniões
  const committeeData = [
    {
      name: 'Comissão de Constituição e Justiça', acronym: 'CCJ', kind: 'permanente', description: 'Análise de constitucionalidade, legalidade e técnica legislativa.',
      members: [
        { name: 'Roberto Nogueira', role: 'presidente' },
        { name: 'Geraldo Bezerra', role: 'relator' },
        { name: 'Sandra Ribeiro', role: 'titular' },
      ],
      meetings: [
        { scheduledAt: at(-10, 14), subject: 'Parecer ao PL 45 e PL 46', status: 'realizada', notes: 'Pareceres aprovados por unanimidade.' },
        { scheduledAt: at(3, 15), subject: 'Análise do PL 47 (acessibilidade)', status: 'agendada', notes: null },
      ],
    },
    {
      name: 'Comissão de Finanças e Orçamento', acronym: 'CFO', kind: 'permanente', description: 'Fiscalização financeira, orçamentária e tributária.',
      members: [
        { name: 'Antônio Ferraz', role: 'presidente' },
        { name: 'Ricardo Tavares', role: 'relator' },
        { name: 'Geraldo Bezerra', role: 'titular' },
      ],
      meetings: [{ scheduledAt: at(5, 9), subject: 'Acompanhamento da execução orçamentária', status: 'agendada', notes: null }],
    },
    {
      name: 'Comissão de Educação e Cultura', acronym: 'CEC', kind: 'permanente', description: 'Políticas educacionais, culturais e esportivas.',
      members: [
        { name: 'Sandra Ribeiro', role: 'presidente' },
        { name: 'Elaine Cristina Souza', role: 'relator' },
        { name: 'Fátima do Carmo', role: 'titular' },
      ],
      meetings: [{ scheduledAt: at(-4, 16), subject: 'Sessão solene dos professores', status: 'realizada', notes: 'Definidos detalhes da solenidade.' }],
    },
    {
      name: 'Comissão de Saúde e Assistência Social', acronym: 'CSAS', kind: 'permanente', description: 'Políticas de saúde e assistência social.',
      members: [
        { name: 'Carla Mendes', role: 'presidente' },
        { name: 'Shirley Nascimento', role: 'relator' },
        { name: 'Douglas Pereira', role: 'titular' },
      ],
      meetings: [],
    },
  ]
  for (const c of committeeData) {
    const created = await db.committee.create({ data: { tenantId: t, name: c.name, acronym: c.acronym, kind: c.kind, description: c.description } })
    for (const m of c.members) {
      await db.committeeMember.create({ data: { committeeId: created.id, parliamentarianId: parl[m.name].id, role: m.role, startDate: legStart } })
    }
    for (const mt of c.meetings) {
      await db.committeeMeeting.create({ data: { committeeId: created.id, scheduledAt: mt.scheduledAt, subject: mt.subject, status: mt.status, notes: mt.notes } })
    }
  }

  // Mandatos da legislatura atual
  const voteCounts: Record<string, number> = {
    'Roberto Nogueira': 3120, 'Antônio Ferraz': 2874, 'Sandra Ribeiro': 2610, 'Carla Mendes': 2495,
    'João Bosco Lima': 2340, 'Marta Cardoso': 2298, 'Paulo Sérgio Alves': 2187, 'Elaine Cristina Souza': 2088,
    'Geraldo Bezerra': 1976, 'Fátima do Carmo': 1893, 'Ricardo Tavares': 1782, 'Shirley Nascimento': 1714,
    'Douglas Pereira': 1665,
  }
  for (const p of parlData) {
    await db.mandate.create({ data: { tenantId: t, parliamentarianId: parl[p.name].id, legislatureId: legislature.id, startDate: legStart, votes: voteCounts[p.name] ?? null } })
  }

  // Afastamentos (histórico + vigente)
  await db.leave.create({
    data: { tenantId: t, parliamentarianId: parl['Douglas Pereira'].id, kind: 'licenca', startDate: at(-20, 10), endDate: at(-13, 18), reason: 'Licença médica (7 dias), atestado anexado ao protocolo.' },
  })
  await db.leave.create({
    data: { tenantId: t, parliamentarianId: parl['João Bosco Lima'].id, kind: 'afastamento', startDate: at(-5, 8), endDate: at(25, 18), reason: 'Missão oficial: Congresso Nacional de Vereadores.' },
  })

  // Tipos de matéria configuráveis
  const matterTypeCfg = [
    { code: 'projeto_de_lei', name: 'Projeto de Lei', defaultRegime: 'ordinario' },
    { code: 'decreto_legislativo', name: 'Decreto Legislativo', defaultRegime: 'ordinario' },
    { code: 'requerimento', name: 'Requerimento', defaultRegime: 'urgencia' },
    { code: 'indicacao', name: 'Indicação', defaultRegime: 'ordinario' },
    { code: 'mocao', name: 'Moção', defaultRegime: 'ordinario' },
    { code: 'emenda', name: 'Emenda', defaultRegime: 'ordinario' },
  ]
  for (const mt of matterTypeCfg) await db.matterTypeConfig.create({ data: { tenantId: t, ...mt } })

  console.log('Fase 5: tramitação, protocolo e tarefas…')
  // Tramitação (append-only, coerente com o status atual de cada matéria)
  const proceedingSeed: Array<{ key: string; steps: Array<{ action: string; toStatus: string; notes: string; when: [number, number, number?]; dueInDays?: number }> }> = [
    {
      key: `projeto_de_lei-41/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Despacho inicial à CCJ para análise de constitucionalidade.', when: [-45, 9] },
        { action: 'parecer', toStatus: 'em_tramitacao', notes: 'Parecer favorável da CCJ (relator Geraldo Bezerra).', when: [-30, 14] },
        { action: 'inclusao_pauta', toStatus: 'incluida_pauta', notes: 'Incluída na Ordem do Dia da 1ª Sessão Ordinária.', when: [-12, 10] },
        { action: 'sessao', toStatus: 'aprovado', notes: 'Aprovada em votação nominal na 1ª Sessão Ordinária.', when: [-7, 20] },
      ],
    },
    {
      key: `projeto_de_lei-43/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Despacho inicial: CCJ e Comissão de Educação.', when: [-18, 9] },
        { action: 'parecer', toStatus: 'em_tramitacao', notes: 'Pareceres favoráveis das comissões.', when: [-6, 15] },
        { action: 'inclusao_pauta', toStatus: 'incluida_pauta', notes: 'Incluída na Ordem do Dia da 2ª Sessão Ordinária.', when: [-3, 11] },
      ],
    },
    {
      key: `projeto_de_lei-44/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Despacho em regime de urgência (art. 178 do Regimento).', when: [-9, 9] },
        { action: 'parecer', toStatus: 'em_tramitacao', notes: 'Parecer da CCJ pela constitucionalidade.', when: [-4, 10] },
        { action: 'inclusao_pauta', toStatus: 'incluida_pauta', notes: 'Incluída em urgência na 2ª Sessão Ordinária.', when: [-2, 14] },
      ],
    },
    {
      key: `projeto_de_lei-45/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Despacho inicial à CCJ.', when: [-15, 9] },
        { action: 'parecer', toStatus: 'em_tramitacao', notes: 'Parecer favorável da CCJ na reunião de 10 dias atrás.', when: [-10, 14], dueInDays: 2 },
      ],
    },
    {
      key: `projeto_de_lei-46/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Protocolado pelo Executivo; despacho à CFO e CCJ.', when: [-8, 9], dueInDays: 5 },
      ],
    },
    {
      key: `requerimento-121/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Despacho: resposta do Executivo em 30 dias.', when: [-6, 10] },
        { action: 'inclusao_pauta', toStatus: 'incluida_pauta', notes: 'Incluído na Ordem do Dia da 2ª Sessão.', when: [-2, 11] },
      ],
    },
    {
      key: `requerimento-127/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Audiência pública requerida; aguardando designação.', when: [-5, 10], dueInDays: 10 },
      ],
    },
    {
      key: `decreto_legislativo-7/${YEAR}`, steps: [
        { action: 'despacho', toStatus: 'em_tramitacao', notes: 'Título de cidadã: parecer da CCJ e quórum de 2/3 na deliberação.', when: [-11, 9] },
      ],
    },
  ]
  for (const ps of proceedingSeed) {
    const matterId = matters[ps.key]
    if (!matterId) continue
    let seq = 1
    for (const step of ps.steps) {
      await db.proceeding.create({
        data: {
          matterId,
          seq: seq++,
          action: step.action,
          fromStatus: seq === 2 ? 'em_tramitacao' : (seq === 3 ? 'em_tramitacao' : 'incluida_pauta'),
          toStatus: step.toStatus,
          actorName: 'Paula Andrade',
          actorRole: 'legislative_admin',
          notes: step.notes,
          dueAt: step.dueInDays ? at(step.dueInDays, 12) : null,
          createdAt: at(step.when[0], step.when[1], step.when[2] ?? 0),
        },
      })
    }
  }

  // Versões e anexos
  const pl43 = matters[`projeto_de_lei-43/${YEAR}`]
  const pl45 = matters[`projeto_de_lei-45/${YEAR}`]
  const pl46 = matters[`projeto_de_lei-46/${YEAR}`]
  await db.matterVersion.create({ data: { matterId: pl43, version: 1, text: 'Art. 1º Fica criado o Dia Municipal de Conscientização sobre a Dislexia, a ser observado anualmente em 8 de outubro, com promoção de campanhas educativas nas escolas da rede municipal.', authorName: 'Elaine Cristina Souza', createdAt: at(-18, 8) } })
  await db.matterVersion.create({ data: { matterId: pl43, version: 2, text: 'Art. 1º Fica criado o Dia Municipal de Conscientização sobre a Dislexia, a ser observado anualmente em 8 de outubro. § 1º As campanhas educativas serão produzidas em parceria com a Secretaria Municipal de Educação. § 2º Incluem-se atividades de formação continuada para professores da rede municipal.', authorName: 'Comissão de Educação e Cultura', createdAt: at(-6, 15) } })
  await db.matterVersion.create({ data: { matterId: pl45, version: 1, text: 'Art. 1º Fica instituída a Semana Municipal de Combate ao Desperdício de Alimentos, no período de 16 a 22 de setembro, com ações de educação alimentar e apoio a bancos de alimentos.', authorName: 'Marta Cardoso', createdAt: at(-15, 8) } })
  await db.matterVersion.create({ data: { matterId: pl46, version: 1, text: 'Art. 1º Fica o Poder Executivo autorizado a conceder auxílio-transporte aos servidores da educação básica do Município, na forma desta Lei.', authorName: 'Executivo Municipal', createdAt: at(-8, 8) } })
  // Exemplos de metadados: sem PDF real, não publicar URL de download fictícia.
  await db.matterAttachment.create({ data: { matterId: pl43, name: 'Texto integral (substitutivo).pdf', kind: 'texto_integral', sizeBytes: 0, createdAt: at(-6, 15) } })
  await db.matterAttachment.create({ data: { matterId: pl43, name: 'Parecer CCJ nº 12.pdf', kind: 'parecer', sizeBytes: 0, createdAt: at(-6, 16) } })
  await db.matterAttachment.create({ data: { matterId: pl46, name: 'Mensagem do Executivo.pdf', kind: 'anexo', sizeBytes: 0, createdAt: at(-8, 9) } })

  // Protocolo (auto-numerado por ano)
  const protocolSeed = [
    { kind: 'materia', senderName: 'Executivo Municipal', subject: 'PL 46 — Auxílio-transporte aos servidores da educação.', matterId: pl46!, status: 'distribuido', at: [-8, 8, 30] },
    { kind: 'requerimento', senderName: 'Vereadora Marta Cardoso', subject: 'Requerimento de audiência pública sobre saneamento básico.', matterId: matters[`requerimento-127/${YEAR}`]!, status: 'distribuido', at: [-5, 9, 10] },
    { kind: 'oficio', senderName: 'Ministério Público Municipal', subject: 'Ofício de recomendação sobre educação alimentar escolar.', matterId: null, status: 'recebido', at: [-3, 14] },
    { kind: 'documento', senderName: 'Tribunal de Contas do Estado', subject: 'Parecer prévio sobre as contas do Executivo.', matterId: null, status: 'recebido', at: [-2, 10] },
    { kind: 'documento', senderName: 'Associação dos Moradores — Jardim Primavera', subject: 'Abaixo-assinado solicitando iluminação pública.', matterId: null, status: 'arquivado', at: [-15, 11], note: 'Arquivado: objeto já atendido pela IND 89.' },
    { kind: 'oficio', senderName: 'Prefeitura Municipal', subject: 'Convite para inauguração de creche municipal.', matterId: null, status: 'anulado', at: [-12, 9], note: 'Anulado: documento em duplicidade (protocolo nº 3 do exercício anterior).' },
    { kind: 'documento', senderName: 'Vereador Douglas Pereira', subject: 'Atestado médico — licença de 7 dias.', matterId: null, status: 'arquivado', at: [-20, 8, 45] },
    { kind: 'oficio', senderName: 'Câmara de Serra Azul', subject: 'Moção de solidariedade às vítimas das enchentes.', matterId: null, status: 'recebido', at: [0, 8, 20] },
  ]
  let protoNumber = 0
  for (const pr of protocolSeed) {
    protoNumber++
    await db.protocolEntry.create({
      data: {
        tenantId: t, number: protoNumber, year: YEAR, kind: pr.kind, senderName: pr.senderName,
        subject: pr.subject, matterId: pr.matterId, status: pr.status, notes: pr.note ?? null,
        createdAt: at(pr.at[0], pr.at[1], pr.at[2] ?? 0),
      },
    })
  }

  // Tarefas e prazos (2 vencidas, 3 pendentes, 1 concluída)
  const taskSeed = [
    { title: 'Emitir parecer da CCJ ao PL 45 (vencido)', kind: 'parecer', dueAt: at(-2, 12), status: 'pendente', matterId: pl45!, assigneeName: 'Comissão de Constituição e Justiça' },
    { title: 'Distribuir ofício do Ministério Público (vencido)', kind: 'distribuicao', dueAt: at(-1, 17), status: 'pendente', matterId: null, assigneeName: 'Diretoria Legislativa' },
    { title: 'Designar audiência pública do REQ 127', kind: 'prazo', dueAt: at(2, 12), status: 'pendente', matterId: matters[`requerimento-127/${YEAR}`]!, assigneeName: 'Mesa Diretora' },
    { title: 'Publicar pauta da 3ª Sessão Ordinária', kind: 'prazo', dueAt: at(5, 10), status: 'pendente', matterId: null, assigneeName: 'Diretoria Legislativa' },
    { title: 'Parecer da CFO ao PL 46 (auxílio-transporte)', kind: 'parecer', dueAt: at(10, 12), status: 'pendente', matterId: pl46!, assigneeName: 'Comissão de Finanças e Orçamento' },
    { title: 'Enviar espelho da 1ª Sessão ao arquivo geral', kind: 'outro', dueAt: at(-6, 12), status: 'concluida', matterId: null, assigneeName: 'Secretaria da Câmara' },
  ]
  for (const task of taskSeed) {
    await db.legislativeTask.create({ data: { tenantId: t, matterId: task.matterId, title: task.title, kind: task.kind, dueAt: task.dueAt, status: task.status, assigneeName: task.assigneeName } })
  }

  // Auditoria da fase 5 (após o último evento existente — at(-1, 9, 40))
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'structure.seeded', aggregateType: 'tenant', aggregateId: t, summary: 'Cadastros institucionais importados: partidos, blocos, mesa diretora, comissões, mandatos e afastamentos.', createdAt: at(-1, 10) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'matter.proceeding', aggregateType: 'matter', aggregateId: pl43, summary: 'Tramitação registrada: inclusão do PL 43 na pauta da 2ª Sessão Ordinária.', after: { status: 'incluida_pauta' }, createdAt: at(-1, 11) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'protocol.registered', aggregateType: 'protocol', summary: 'Protocolo nº 8 registrado: ofício da Câmara de Serra Azul.', createdAt: at(0, 8, 20) })

  // ════════════════════════════════════════════════════════════════
  // FASE 8 — Console da Plataforma SaaS: planos, assinaturas e 2º tenant
  // ════════════════════════════════════════════════════════════════
  console.log('Fase 8: planos, assinaturas e tenant demo 2…')

  const planStarter = await db.plan.create({
    data: {
      name: 'starter',
      priceCents: 29900,
      limits: JSON.stringify({ maxParliamentarians: 10, maxSessionsPerMonth: 12, features: [] }),
    },
  })
  const planProfissional = await db.plan.create({
    data: {
      name: 'profissional',
      priceCents: 59900,
      limits: JSON.stringify({ maxParliamentarians: 25, maxSessionsPerMonth: 40, features: ['ai_assist'] }),
    },
  })
  await db.plan.create({
    data: {
      name: 'enterprise',
      priceCents: 149900,
      limits: JSON.stringify({ maxParliamentarians: 100, maxSessionsPerMonth: 200, features: ['ai_assist', 'white_label_avancado', 'api_publica'] }),
    },
  })

  // Assinatura do tenant demo: profissional, ativa (recurso ai_assist habilitado)
  await db.subscription.create({
    data: {
      tenantId: t,
      planId: planProfissional.id,
      status: 'active',
      currentPeriodEnd: new Date(Date.UTC(YEAR + 1, 0, 15, 12, 0, 0)),
    },
  })

  // ── Tenant 2: Câmara Municipal de Serra Azul/SP (trial starter, 10 dias) ──
  const t2 = await db.tenant.create({
    data: {
      slug: 'camara-serra-azul',
      name: 'Câmara Municipal de Serra Azul',
      city: 'Serra Azul',
      uf: 'SP',
      plan: 'starter',
      primaryColor: '#166a45',
      accentColor: '#b45309',
      timezone: 'America/Sao_Paulo',
      settings: JSON.stringify({
        quorumMinimum: 5,
        allowVoteChange: true,
        speechDefaultSeconds: 300,
        soundAlerts: true,
        hidePartialByDefault: false,
      }),
    },
  })

  const legislature2 = await db.legislature.create({
    data: { tenantId: t2.id, number: 7, startYear: YEAR, endYear: YEAR + 3, current: true },
  })

  const parl2Data = [
    { name: 'José Almeida Neto', party: 'PSDB', boardRole: 'presidente' },
    { name: 'Rosa Ventania', party: 'PT', boardRole: 'vice_presidente' },
    { name: 'Aparecido dos Santos', party: 'MDB', boardRole: 'primeiro_secretario' },
    { name: 'Beatriz Camargo', party: 'PV', boardRole: 'vereador' },
    { name: 'Carlos Eduardo Prado', party: 'PP', boardRole: 'vereador' },
    { name: 'Débora Nunes', party: 'PSD', boardRole: 'vereador' },
    { name: 'Élcio Farias', party: 'Republican', boardRole: 'vereador' },
    { name: 'Fátima Gonzaga', party: 'PDT', boardRole: 'vereador' },
    { name: 'Gilson Andrade', party: 'PL', boardRole: 'vereador' },
  ]
  const parl2: Record<string, { id: string }> = {}
  let order2 = 0
  const leg2Start = new Date(Date.UTC(YEAR, 0, 1, 12, 0, 0))
  for (const p of parl2Data) {
    const created = await db.parliamentarian.create({
      data: { tenantId: t2.id, order: order2++, ...p },
    })
    parl2[p.name] = created
    await db.mandate.create({
      data: { tenantId: t2.id, parliamentarianId: created.id, legislatureId: legislature2.id, startDate: leg2Start },
    })
  }

  // Usuário tenant_admin do tenant 2 (aparece no bootstrap ?tenant=camara-serra-azul)
  await db.user.create({
    data: {
      tenantId: t2.id,
      name: 'Marta Lima',
      email: 'marta.lima@serraazul.sp.leg.br',
      role: 'tenant_admin',
      jobTitle: 'Administradora da Câmara',
    },
  })

  // Assinatura do tenant 2: starter em TRIAL (expira em 10 dias) — sem ai_assist
  await db.subscription.create({
    data: {
      tenantId: t2.id,
      planId: planStarter.id,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    },
  })

  // Matérias do tenant 2 (5)
  const matters2: Record<string, string> = {}
  const matter2Data = [
    { type: 'projeto_de_lei', number: 12, ementa: 'Institui a Feira Municipal de Economia Solidária e dá outras providências.', authors: ['Rosa Ventania'], status: 'aprovado' },
    { type: 'projeto_de_lei', number: 13, ementa: 'Altera o horário de funcionamento dos mercados municipais.', authors: ['Carlos Eduardo Prado'], status: 'em_tramitacao' },
    { type: 'requerimento', number: 30, ementa: 'Requer ao Executivo informações sobre a frota de veículos oficiais e sua manutenção.', authors: ['Élcio Farias'], status: 'aprovado' },
    { type: 'indicacao', number: 14, ementa: 'Indica ao Executivo a manutenção urgente da Praça Matriz.', authors: ['Beatriz Camargo', 'Fátima Gonzaga'], status: 'em_tramitacao' },
    { type: 'mocao', number: 4, ementa: 'Moção de Apoio à campanha municipal de vacinação contra a gripe.', authors: ['Débora Nunes'], status: 'incluida_pauta' },
  ]
  for (const m of matter2Data) {
    const created = await db.legislativeMatter.create({
      data: { tenantId: t2.id, ...m, year: YEAR, authors: JSON.stringify(m.authors) },
    })
    matters2[`${m.type}-${m.number}`] = created.id
  }

  // Sessão 1 do tenant 2 (encerrada há ~12 dias, com 1 votação aprovada)
  const s2t2 = await db.session.create({
    data: {
      tenantId: t2.id,
      number: 1,
      year: YEAR,
      type: 'ordinaria',
      scheduledAt: at(-12, 19),
      openedAt: at(-12, 19, 3),
      closedAt: at(-12, 21, 10),
      status: 'closed',
      presidentId: parl2['José Almeida Neto'].id,
      presidentName: 'José Almeida Neto',
      secretaryName: 'Marta Lima',
      location: 'Plenário Adelino Simão',
      agendaPublished: true,
      version: 3,
    },
  })
  let ord2 = 0
  await db.agendaItem.create({
    data: {
      sessionId: s2t2.id, order: ord2++, section: 'expediente',
      title: 'Abertura dos trabalhos e verificação de quórum.', status: 'aprovado',
    },
  })
  await db.agendaItem.create({
    data: {
      sessionId: s2t2.id, order: ord2++, section: 'ordem_do_dia',
      matterId: matters2['projeto_de_lei-12'], matterType: 'projeto_de_lei', matterNumber: `12/${YEAR}`, matterYear: YEAR,
      title: `PL 12/${YEAR} — Feira Municipal de Economia Solidária.`,
      status: 'aprovado', resultSummary: 'Aprovado por 6 votos sim e 1 abstenção.',
    },
  })
  await db.agendaItem.create({
    data: {
      sessionId: s2t2.id, order: ord2++, section: 'ordem_do_dia',
      matterId: matters2['requerimento-30'], matterType: 'requerimento', matterNumber: `30/${YEAR}`, matterYear: YEAR,
      title: `REQ 30/${YEAR} — Informações sobre a frota de veículos oficiais.`,
      status: 'aprovado', resultSummary: 'Aprovado por unanimidade em votação simbólica.',
    },
  })

  // Presenças: 7 presentes + 2 ausentes
  const present2 = ['José Almeida Neto', 'Rosa Ventania', 'Aparecido dos Santos', 'Beatriz Camargo', 'Débora Nunes', 'Élcio Farias', 'Fátima Gonzaga']
  for (const name of present2) {
    await db.attendanceEvent.create({
      data: { sessionId: s2t2.id, parliamentarianId: parl2[name].id, kind: 'check_in', status: 'presente', source: 'operador', createdAt: at(-12, 18, 50) },
    })
  }
  await db.attendanceEvent.create({
    data: { sessionId: s2t2.id, parliamentarianId: parl2['Carlos Eduardo Prado'].id, kind: 'mark', status: 'ausente', source: 'operador', createdAt: at(-12, 19, 5) },
  })
  await db.attendanceEvent.create({
    data: { sessionId: s2t2.id, parliamentarianId: parl2['Gilson Andrade'].id, kind: 'mark', status: 'licenciado', source: 'operador', note: 'Licença viagem oficial.', createdAt: at(-12, 18, 55) },
  })

  // Votação nominal aprovada (6 sim, 1 abstenção)
  const v2t2 = await db.voting.create({
    data: {
      sessionId: s2t2.id,
      matterId: matters2['projeto_de_lei-12'],
      question: `Projeto de Lei nº 12/${YEAR} — Feira Municipal de Economia Solidária`,
      mode: 'nominal',
      status: 'closed',
      rule: 'maioria_simples',
      openedAt: at(-12, 20, 12),
      closedAt: at(-12, 20, 18),
      presentAtOpen: 7,
      quorumAtOpen: 5,
      presentAtClose: 7,
      quorumAtClose: 5,
      resultStatus: 'aprovado',
      resultCounts: JSON.stringify({ sim: 6, nao: 0, abstencoes: 1, naoRegistraram: 0, presentes: 7 }),
      resultDetail: JSON.stringify(
        present2.map((name, i) => ({
          parliamentarianId: parl2[name].id,
          name,
          value: name === 'Fátima Gonzaga' ? 'abstencao' : 'sim',
          order: i,
        }))
      ),
      version: 2,
    },
  })
  for (const name of present2) {
    const value = name === 'Fátima Gonzaga' ? 'abstencao' : 'sim'
    await db.vote.create({
      data: { votingId: v2t2.id, parliamentarianId: parl2[name].id, value, commandId: randomUUID(), receivedAt: at(-12, 20, 13) },
    })
  }

  // Sessão 2 do tenant 2 (futura, +5 dias, pauta em elaboração)
  const s2b = await db.session.create({
    data: {
      tenantId: t2.id,
      number: 2,
      year: YEAR,
      type: 'ordinaria',
      scheduledAt: at(5, 19),
      status: 'draft',
      presidentId: parl2['José Almeida Neto'].id,
      presidentName: 'José Almeida Neto',
      secretaryName: 'Marta Lima',
      location: 'Plenário Adelino Simão',
      agendaPublished: false,
      version: 1,
    },
  })
  await db.agendaItem.create({
    data: { sessionId: s2b.id, order: 0, section: 'expediente', title: 'Abertura dos trabalhos.', status: 'pendente' },
  })

  // Auditoria do tenant 2 — CADEIA PRÓPRIA (hash chain por tenant, ver audit())
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'session.created', aggregateType: 'session', aggregateId: s2t2.id, summary: 'Sessão criada com pauta de 3 itens.', createdAt: at(-13, 9) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'session.scheduled', aggregateType: 'session', aggregateId: s2t2.id, summary: 'Pauta publicada e sessão agendada.', before: { status: 'draft' }, after: { status: 'scheduled' }, createdAt: at(-13, 9, 20) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'session.opened', aggregateType: 'session', aggregateId: s2t2.id, summary: 'Sessão aberta com quórum de 7 parlamentares.', before: { status: 'check_in' }, after: { status: 'open' }, createdAt: at(-12, 19, 3) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'voting.opened', aggregateType: 'voting', aggregateId: v2t2.id, summary: `Votação aberta: PL 12/${YEAR}.`, after: { status: 'open' }, createdAt: at(-12, 20, 12) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'voting.closed', aggregateType: 'voting', aggregateId: v2t2.id, summary: `Votação encerrada: PL 12/${YEAR} — resultado aprovado.`, before: { status: 'open' }, after: { status: 'closed', resultStatus: 'aprovado' }, createdAt: at(-12, 20, 18) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'session.closed', aggregateType: 'session', aggregateId: s2t2.id, summary: 'Sessão encerrada às 21h10.', before: { status: 'open' }, after: { status: 'closed' }, createdAt: at(-12, 21, 10) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'session.created', aggregateType: 'session', aggregateId: s2b.id, summary: 'Sessão futura criada (pauta em elaboração).', createdAt: at(-1, 10) })

  // Sessões demonstrativas criadas diretamente precisam manter o contador usado pela API.
  await db.sessionNumberCounter.createMany({ data: [
    { tenantId: t, year: YEAR, lastNumber: 3 },
    { tenantId: t2.id, year: YEAR, lastNumber: 2 },
  ] })

  // ════════════════════════════════════════════════════════════════
  // FASE 9 — Autenticação real: senhas demo + usuário inativo
  // ════════════════════════════════════════════════════════════════
  console.log('Fase 9: senhas de demonstração…')
  // Todos os usuários de demonstração recebem senha. Uma lista fixa deixava
  // justamente os papéis da Mesa (presidência, operador de sessão, direção
  // legislativa e auditoria) sem `passwordHash`, e o login por senha falhava
  // para eles enquanto a entrada por perfil funcionava.
  await db.user.updateMany({
    where: { passwordHash: null },
    data: { passwordHash: hashPassword(DEMO_PASSWORD) },
  })
  // Usuário inativo (demonstra bloqueio imediato de acesso)
  await db.user.create({
    data: {
      tenantId: t,
      name: 'Tiago Almeida',
      email: 'tiago.almeida@vilanova.mg.leg.br',
      role: 'session_operator',
      jobTitle: 'Operador de Sessão (afastado)',
      passwordHash: hashPassword(DEMO_PASSWORD),
      active: false,
    },
  })

  // ════════════════════════════════════════════════════════════════
  // FASE 10 — Faturamento: histórico pago + vencida (dunning no ciclo)
  // ════════════════════════════════════════════════════════════════
  console.log('Fase 10: faturas de demonstração…')
  // Aritmética de mês com CLAMP de dia (31 de agosto − 2 meses = 30 de junho,
  // nunca 1º de julho — evita colisão de competência e P2002 no unique).
  const addMonths = (base: Date, delta: number): Date => {
    const d = new Date(base)
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + delta)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDay))
    d.setHours(base.getHours(), base.getMinutes(), 0, 0)
    return d
  }
  const monthAgo = addMonths(local, -1)
  const twoMonthsAgo = addMonths(local, -2)
  const fmtPeriod = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

  const planLine = (planName: string, period: Date, priceCents: number) => ({
    description: `Plano ${planName} — competência ${fmtPeriod(period)}`,
    quantity: 1,
    unitCents: priceCents,
    totalCents: priceCents,
  })

  // Tenant 1 (profissional): 2 faturas pagas + a do mês corrente em aberta
  await db.invoice.create({
    data: {
      tenantId: t, number: 1, periodYear: twoMonthsAgo.getFullYear(), periodMonth: twoMonthsAgo.getMonth() + 1,
      status: 'paid', lines: JSON.stringify([planLine('profissional', twoMonthsAgo, 59900)]),
      subtotalCents: 59900, totalCents: 59900, issuedAt: twoMonthsAgo,
      dueAt: new Date(twoMonthsAgo.getTime() + 10 * 86400000), paidAt: new Date(twoMonthsAgo.getTime() + 6 * 86400000),
      paidMethod: 'pix',
    },
  })
  await db.invoice.create({
    data: {
      tenantId: t, number: 2, periodYear: monthAgo.getFullYear(), periodMonth: monthAgo.getMonth() + 1,
      status: 'paid', lines: JSON.stringify([planLine('profissional', monthAgo, 59900)]),
      subtotalCents: 59900, totalCents: 59900, issuedAt: monthAgo,
      dueAt: new Date(monthAgo.getTime() + 10 * 86400000), paidAt: new Date(monthAgo.getTime() + 4 * 86400000),
      paidMethod: 'boleto',
    },
  })
  await db.invoice.create({
    data: {
      tenantId: t, number: 3, periodYear: YEAR, periodMonth: local.getMonth() + 1,
      status: 'open', lines: JSON.stringify([planLine('profissional', local, 59900)]),
      subtotalCents: 59900, totalCents: 59900, issuedAt: at(0, 8),
      dueAt: new Date(local.getTime() + 10 * 86400000),
    },
  })

  // Tenant 2 (starter): 1 paga + 1 VENCIDA (open, dueAt no passado → ciclo marca past_due)
  await db.invoice.create({
    data: {
      tenantId: t2.id, number: 1, periodYear: twoMonthsAgo.getFullYear(), periodMonth: twoMonthsAgo.getMonth() + 1,
      status: 'paid', lines: JSON.stringify([planLine('starter', twoMonthsAgo, 29900)]),
      subtotalCents: 29900, totalCents: 29900, issuedAt: twoMonthsAgo,
      dueAt: new Date(twoMonthsAgo.getTime() + 10 * 86400000), paidAt: new Date(twoMonthsAgo.getTime() + 7 * 86400000),
      paidMethod: 'pix',
    },
  })
  const overdueInv = await db.invoice.create({
    data: {
      tenantId: t2.id, number: 2, periodYear: monthAgo.getFullYear(), periodMonth: monthAgo.getMonth() + 1,
      status: 'open', lines: JSON.stringify([
        planLine('starter', monthAgo, 29900),
        { description: 'Excedente de parlamentares (0 acima do limite 10)', quantity: 0, unitCents: 2500, totalCents: 0 },
      ]),
      subtotalCents: 29900, totalCents: 29900, issuedAt: monthAgo,
      dueAt: new Date(local.getTime() - 5 * 86400000), // vencida há 5 dias
    },
  })

  await audit({ tenantId: t2.id, actorName: 'Suporte Legis SaaS', actorRole: 'platform_owner', action: 'billing.invoice_created', aggregateType: 'invoice', aggregateId: overdueInv.id, summary: `Fatura 0002/${monthAgo.getFullYear()} emitida (competência ${fmtPeriod(monthAgo)}) — vencida, aguardando ciclo de dunning.`, after: { status: 'open', totalCents: 29900 }, createdAt: at(0, 9) })

  // ════════════════════════════════════════════════════════════════
  // FASE 11 — Publicações oficiais + audiências públicas
  // ════════════════════════════════════════════════════════════════
  console.log('Fase 11: publicações e audiências…')
  const verificationCode = () =>
    Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('')

  const pub1 = await db.publication.create({
    data: {
      tenantId: t, number: 1, year: YEAR, kind: 'ata_sessao',
      title: `Ata da 1ª Sessão Ordinária de ${YEAR}`,
      contentMd: `Aos sete dias do mês corrente, no Plenário Anísio Teixeira, com quórum verificado, o Presidente declarou abertos os trabalhos da 1ª Sessão Ordinária. Lida e aprovada a ata da sessão anterior, procedeu-se à ordem do dia com a deliberação das matérias constantes da pauta publicada. Nada mais havendo a tratar, o Presidente encerrou a sessão. Eu, Marcos Vieira, a fiz lavrar.`,
      sessionId: s1.id, status: 'published', publishedAt: at(-6, 10), verificationCode: verificationCode(),
    },
  })
  const pub2 = await db.publication.create({
    data: {
      tenantId: t, number: 2, year: YEAR, kind: 'decreto',
      title: `Decreto Legislativo nº 1/${YEAR} — Título de Cidadã Vilanovense`,
      contentMd: `A Mesa Diretora da Câmara Municipal de Vila Nova, no uso de suas atribuições regimentais, CONCEDE o Título de Cidadã Vilanovense à professora emérita Dra. Helena Vasconcelos, pelos relevantes serviços prestados à educação do Município. Publique-se e cumpra-se.`,
      status: 'published', publishedAt: at(-5, 9), verificationCode: verificationCode(),
    },
  })
  void pub2
  await db.publication.create({
    data: {
      tenantId: t, number: 3, year: YEAR, kind: 'portaria',
      title: `Portaria nº 14/${YEAR} — Revoga a Portaria nº 9/${YEAR} (horário de atendimento)`,
      contentMd: `O Presidente da Câmara Municipal de Vila Nova REVOGA a Portaria nº 9, de ${YEAR - 1}, que alterava provisoriamente o horário de atendimento ao público, RESTABELECENDO o atendimento das 9h às 17h.`,
      status: 'published', publishedAt: at(-4, 14), verificationCode: verificationCode(),
    },
  })
  const pub4 = await db.publication.create({
    data: {
      tenantId: t, number: 4, year: YEAR, kind: 'edital',
      title: `Edital de Convocação — Audiência Pública do Plano de Saneamento`,
      contentMd: `Fica convocada Audiência Pública para debater o Plano Municipal de Saneamento Básico. Participação presencial no Plenário e remota pelo portal de transparência.`,
      status: 'published', publishedAt: at(-3, 8), verificationCode: verificationCode(),
    },
  })
  // Revogada: portaria antiga (deixa rastro histórico público)
  await db.publication.create({
    data: {
      tenantId: t, number: 5, year: YEAR, kind: 'resolucao',
      title: `Resolução nº 3/${YEAR} — Comissão especial do orçamento`,
      contentMd: `Institui comissão especial para acompanhamento da execução orçamentária do exercício.`,
      status: 'revoked', publishedAt: at(-9, 10), revokedAt: at(-2, 15),
      revokedReason: 'Revogada pela Resolução nº 4, que instituiu comissão com nova composição e atribuições ampliadas.',
      verificationCode: verificationCode(),
    },
  })

  // Audiência 1: AGORA (aberta, recebendo perguntas)
  const hearing1 = await db.publicHearing.create({
    data: {
      tenantId: t, title: 'Audiência Pública — Plano Municipal de Saneamento Básico',
      subject: 'Apresentação e debate das metas do plano de saneamento para o próximo quadrimestre.',
      matterId: matters[`requerimento-127/${YEAR}`],
      scheduledAt: at(0, 15), location: 'Plenário Anísio Teixeira', status: 'open', questionsOpen: true,
    },
  })
  // Audiência 2: futura (agendada)
  await db.publicHearing.create({
    data: {
      tenantId: t, title: 'Audiência Pública — Orçamento Participativo',
      subject: 'Priorização de obras e serviços para o próximo exercício financeiro.',
      scheduledAt: at(12, 19), location: 'Ginásio Municipal', status: 'scheduled', questionsOpen: true,
    },
  })
  // Audiência 3: encerrada (histórico)
  const hearing3 = await db.publicHearing.create({
    data: {
      tenantId: t, title: 'Audiência Pública — Segurança Escolar',
      subject: 'Debate sobre investimentos em segurança nas escolas municipais.',
      scheduledAt: at(-10, 19), location: 'Plenário Anísio Teixeira', status: 'closed', questionsOpen: false,
    },
  })

  const questions1 = [
    { authorName: 'Maria Aparecida Lopes', district: 'Centro', question: 'Quais bairros serão atendidos em primeiro lugar pela nova rede de esgoto? O Centro está previsto para este ano?', status: 'answered', answer: 'Sim, o Centro está no lote 1 das obras, com início previsto para o próximo trimestre. A ordem completa dos lotes consta no anexo II do plano.', moderatedBy: 'Paula Andrade', authorEmail: 'maria.aparecida@emaildemo.com' },
    { authorName: 'João Ferreira da Silva', district: 'Jardim Primavera', question: 'Haverá controle social do plano? Como os moradores podem acompanhar a execução das obras?', status: 'approved', answer: null, moderatedBy: 'Paula Andrade', authorEmail: 'joao.ferreira@emaildemo.com' },
    { authorName: 'Lúcia Helena Prado', district: 'Bairro Operário', question: 'As ligações domiciliares de água serão substituídas? Minha rua tem vazamento há meses.', status: 'pending', answer: null, moderatedBy: null, authorEmail: 'lucia.prado@emaildemo.com' },
  ]
  for (const q of questions1) {
    await db.hearingQuestion.create({
      data: {
        hearingId: hearing1.id, ...q,
        answeredAt: q.status === 'answered' ? at(0, 16, 20) : null,
        createdAt: at(0, 11, q.status === 'pending' ? 12 : q.status === 'approved' ? 8 : 5),
      },
    })
  }

  // Pergunta respondida da audiência encerrada (histórico)
  await db.hearingQuestion.create({
    data: {
      hearingId: hearing3.id, authorName: 'Centro de Pais e Mestres', district: null,
      question: 'Existe previsão de contratação de vigilância para as escolas da zona rural?',
      status: 'answered', answer: 'Sim, o cronograma físico do programa prevê a contratação até o fim do semestre, contemplando todas as unidades escolares, inclusive as rurais.',
      moderatedBy: 'Paula Andrade', answeredAt: at(-10, 21), createdAt: at(-11, 14), authorEmail: null,
    },
  })

  // ════════════════════════════════════════════════════════════════
  // FASE 14 — Modelos de documento versionados por tenant
  // ════════════════════════════════════════════════════════════════
  console.log('Fase 14: modelos de documento…')

  const templatesSeed: Array<{
    name: string
    kind: string
    description?: string
    versions: Array<{ bodyMd: string; changeNote?: string }>
    active?: boolean
  }> = [
    {
      name: 'Ata de Sessão Ordinária',
      kind: 'ata_sessao',
      description: 'Estrutura regimental de ata com cabeçalho dinâmico da sessão.',
      versions: [
        {
          bodyMd: `**ATA DA SESSÃO ORDINÁRIA**\n\nAos {{data}}, no Plenário da {{camara}}, com presença de vereadores em número regimental, o Presidente declarou abertos os trabalhos. Lida e aprovada a ata da sessão anterior, seguiu-se a leitura do expediente e a ordem do dia.\n\nNada mais havendo a tratar, o Presidente encerrou os trabalhos, lavrando-se a presente ata, que será lida e votada na sessão seguinte.`,
        },
        {
          bodyMd: `**ATA DA {{sessao.tipo}} Nº {{sessao.numero}}**\n\nAos {{sessao.data}}, no Plenário da {{camara}} ({{cidade}}/{{uf}}), com quórum regimental verificado, o Presidente declarou abertos os trabalhos.\n\nLida e aprovada a ata da sessão anterior, procedeu-se à leitura do expediente e à ordem do dia, com a deliberação das matérias constantes da pauta publicada.\n\nNada mais havendo a tratar, o Presidente encerrou os trabalhos; eu, Secretário, a fiz lavrar.\n\n{{cidade}}, {{data}}.`,
          changeNote: 'Cabeçalho dinâmico com número/tipo da sessão e fecho com local e data.',
        },
      ],
    },
    {
      name: 'Decreto Legislativo Padrão',
      kind: 'decreto',
      description: 'Base para decretos legislativos com dispositivo e fecho regimental.',
      versions: [
        {
          bodyMd: `**DECRETO LEGISLATIVO Nº ___/{{ano}}**\n\nA Mesa Diretora da {{camara}}, no uso de suas atribuições regimentais,\n\nRESOLVE:\n\n[Dispositivo do decreto.]\n\nPublique-se, cumpra-se e vigorará na data de sua publicação.\n\n{{cidade}}, {{data}}.`,
        },
      ],
    },
    {
      name: 'Edital de Convocação de Audiência Pública',
      kind: 'edital',
      description: 'Convocação de audiência com orientações de participação popular.',
      versions: [
        {
          bodyMd: `**EDITAL DE CONVOCAÇÃO — AUDIÊNCIA PÚBLICA**\n\nA {{camara}}, por sua Presidência, TORNA PÚBLICO que realizará audiência pública para debater [assunto], com participação presencial e remota pelo portal de transparência.\n\n**Data e horário:** [data/hora] · **Local:** [local]\n\nAs perguntas poderão ser enviadas previamente pelo portal público e serão respondidas durante o evento, após moderação.\n\n{{cidade}}, {{data}}.`,
        },
      ],
    },
    {
      name: 'Portaria de Constituição de Comissão',
      kind: 'portaria',
      description: 'Portaria com artigos numerados para comissões especiais.',
      versions: [
        {
          bodyMd: `**PORTARIA Nº ___/{{ano}}**\n\nO Presidente da {{camara}}, no uso de suas atribuições legais e regimentais,\n\nRESOLVE:\n\nArt. 1º Constituir comissão especial [finalidade], composta por [membros].\n\nArt. 2º A comissão terá o prazo de [prazo] dias, contado da publicação desta portaria.\n\nArt. 3º Esta portaria entra em vigor na data de sua publicação, revogadas as disposições em contrário.\n\n{{cidade}}, {{data}}.`,
        },
      ],
    },
    {
      name: 'Ofício de Convocação de Sessão Extraordinária',
      kind: 'oficio',
      description: 'Convocação individual de parlamentares com confirmação de presença.',
      versions: [
        {
          bodyMd: `**OFÍCIO Nº ___/{{ano}}**\n\n**Assunto:** Convocação de Sessão Extraordinária\n\nPrezado(a) Vereador(a),\n\nConvoco Vossa Excelência para a Sessão Extraordinária a ser realizada em {{data}}, às [horário], no Plenário da {{camara}}, com a seguinte ordem do dia: [pauta].\n\nSolicito confirmação de presença à Secretaria da Mesa.\n\nRespeitosamente,\n\nPresidente da {{camara}}`,
        },
      ],
    },
  ]

  let tplVersion: number
  for (const tpl of templatesSeed) {
    tplVersion = 0
    const created = await db.documentTemplate.create({
      data: {
        tenantId: t,
        name: tpl.name,
        kind: tpl.kind,
        description: tpl.description ?? null,
        active: tpl.active ?? true,
        currentVersion: tpl.versions.length,
      },
    })
    for (const v of tpl.versions) {
      tplVersion += 1
      await db.documentTemplateVersion.create({
        data: {
          templateId: created.id,
          version: tplVersion,
          bodyMd: v.bodyMd,
          changeNote: v.changeNote ?? null,
          authorName: 'Paula Andrade',
        },
      })
    }
  }

  // Modelo do tenant 2 (isolamento demonstrável no módulo e no export)
  const tpl2 = await db.documentTemplate.create({
    data: {
      tenantId: t2.id,
      name: 'Ata de Sessão — Serra Azul',
      kind: 'ata_sessao',
      description: 'Modelo local com identidade da Câmara de Serra Azul.',
      active: true,
      currentVersion: 1,
    },
  })
  await db.documentTemplateVersion.create({
    data: {
      templateId: tpl2.id,
      version: 1,
      bodyMd: `**ATA DA SESSÃO**\n\nAos {{data}}, no Plenário da {{camara}}, com quórum regimental, o Presidente declarou abertos os trabalhos.\n\n{{cidade}}, {{data}}.`,
      authorName: 'Marta Lima',
    },
  })

  // Auditoria das fases 9–11 — EM ORDEM CRONOLÓGICA (a cadeia é verificada por createdAt asc)
  await audit({ tenantId: t, actorName: 'Ana Ribeiro', actorRole: 'tenant_admin', action: 'auth.login', aggregateType: 'user', summary: 'Login por senha de Ana Ribeiro (demonstração da autenticação real).', createdAt: at(0, 8, 40) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'publication.published', aggregateType: 'publication', aggregateId: pub1.id, summary: `Ata da 1ª Sessão Ordinária publicada no diário eletrônico (${pub1.number}/${YEAR}).`, after: { status: 'published' }, createdAt: at(0, 10, 5) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'publication.published', aggregateType: 'publication', aggregateId: pub4.id, summary: `Edital de Convocação da audiência pública publicado (${pub4.number}/${YEAR}).`, after: { status: 'published' }, createdAt: at(0, 10, 10) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'hearing.question_moderated', aggregateType: 'hearing_question', summary: 'Pergunta de Maria Aparecida Lopes aprovada para exibição pública.', after: { status: 'approved' }, createdAt: at(0, 11, 8) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'hearing.state_changed', aggregateType: 'hearing', aggregateId: hearing1.id, summary: 'Audiência pública do saneamento aberta para participação.', before: { status: 'scheduled' }, after: { status: 'open' }, createdAt: at(0, 15) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'hearing.question_answered', aggregateType: 'hearing_question', summary: 'Resposta oficial registrada à pergunta sobre a ordem das obras de esgoto.', after: { status: 'answered' }, createdAt: at(0, 16, 20) })
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'template.created', aggregateType: 'document_template', summary: `Modelo "Ata de Sessão Ordinária" criado (v1) e revisado (v2) — versionamento por tenant.`, after: { currentVersion: 2, kind: 'ata_sessao' }, createdAt: at(0, 17, 0) })
  await audit({ tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'template.created', aggregateType: 'document_template', aggregateId: tpl2.id, summary: 'Modelo local de ata criado para a Câmara de Serra Azul.', after: { currentVersion: 1, kind: 'ata_sessao' }, createdAt: at(0, 17, 10) })

  console.log('Seed concluído ✔')
  console.log(`  Tenant 1: ${tenant.slug} (plano profissional ativo — ai_assist)`)
  // ════════════════════════════════════════════════════════════════
  // ONDA 4 — Fases 17–20: desfechos de matéria, recibos, participação
  // pública e operação/suporte da plataforma
  // ════════════════════════════════════════════════════════════════
  console.log('Onda 4: desfechos, recibos, assinaturas e suporte…')

  const pl41 = matters[`projeto_de_lei-41/${YEAR}`]!
  const pl44 = matters[`projeto_de_lei-44/${YEAR}`]!
  const pl49 = matters[`projeto_de_lei-49/${YEAR}`]!
  const em12 = matters[`emenda-12/${YEAR}`]!

  // ── Fase 17: relacionamentos + desfechos (sanção/veto) ──────────
  await db.relatedMatter.create({
    data: { matterId: pl44, relatedMatterId: em12, kind: 'emenda', notes: 'Emenda apresentada na CCJ à sessão de hoje.' },
  })
  await db.matterOutcome.create({
    data: { matterId: pl41, kind: 'sancao', actorName: 'Prefeito Municipal', date: at(-2, 11), notes: 'Sancionada integralmente e publicada no diário oficial do Município.' },
  })
  await db.legislativeMatter.update({ where: { id: pl41 }, data: { status: 'sancionado' } })
  await db.proceeding.create({
    data: { matterId: pl41, seq: 5, action: 'sanco', fromStatus: 'aprovado', toStatus: 'sancionado', actorName: 'Prefeito Municipal', actorRole: 'executivo', notes: 'Sanção integral com publicação no diário oficial.', createdAt: at(-2, 11) },
  })
  await db.matterOutcome.create({
    data: { matterId: pl49, kind: 'veto_total', actorName: 'Prefeito Municipal', date: at(-1, 15), notes: 'Veto total por inconformidade com a Lei de Diretrizes Orçamentárias (art. 24 da LRF).', dueAt: at(15, 19) },
  })
  await db.proceeding.create({
    data: { matterId: pl49, seq: 1, action: 'veto', fromStatus: 'aprovado', toStatus: 'vetado', actorName: 'Prefeito Municipal', actorRole: 'executivo', notes: 'Veto total apreciado em sessão futura.', createdAt: at(-1, 15) },
  })
  await db.legislativeTask.create({
    data: { tenantId: t, matterId: pl49, title: `Apreciar veto total do PL 49/${YEAR} (transporte público)`, kind: 'prazo', dueAt: at(15, 19), status: 'pendente', assigneeName: 'Plenário' },
  })
  await audit({ tenantId: t, actorName: 'Prefeito Municipal', actorRole: 'executivo', action: 'matter.outcome', aggregateType: 'matter', aggregateId: pl41, summary: `PL 41/${YEAR} sancionado integralmente pelo Executivo.`, before: { status: 'aprovado' }, after: { status: 'sancionado', kind: 'sancao' }, createdAt: at(-2, 11) })
  await audit({ tenantId: t, actorName: 'Prefeito Municipal', actorRole: 'executivo', action: 'matter.outcome', aggregateType: 'matter', aggregateId: pl49, summary: `Veto total recebido para o PL 49/${YEAR} — prazo de apreciação aberto.`, before: { status: 'aprovado' }, after: { status: 'vetado', kind: 'veto_total' }, createdAt: at(-1, 15) })

  // ── Fase 18: votação pronta com opções regimentais + recibos da v1 ──
  const vCustom = await db.voting.create({
    data: {
      sessionId: s2.id,
      matterId: matters[`requerimento-121/${YEAR}`],
      question: `Requerimento nº 121/${YEAR} — Destinação regimental (obras do Bairro São José)`,
      mode: 'nominal',
      status: 'ready',
      rule: 'maioria_simples',
      version: 1,
    },
  })
  for (const [i, o] of [
    { key: 'aprovar_envio', label: 'Aprovar e encaminhar ao Executivo' },
    { key: 'arquivar', label: 'Arquivar o requerimento' },
    { key: 'adiar', label: 'Adiar para a próxima sessão' },
  ].entries()) {
    await db.votingOption.create({ data: { votingId: vCustom.id, key: o.key, label: o.label, order: i } })
  }
  // Recibos verificáveis da votação nominal encerrada v1 (determinísticos — ADR-019)
  const v1ClosedIso = at(-7, 20, 7).toISOString()
  for (const name of presentS1) {
    const value = name === 'Paulo Sérgio Alves' ? 'nao' : name === 'Geraldo Bezerra' ? 'abstencao' : 'sim'
    const { code, hash } = computeReceipt(t, v1.id, parl[name].id, value, v1ClosedIso)
    await db.voteReceipt.create({
      data: { votingId: v1.id, parliamentarianId: parl[name].id, receiptCode: code, payloadHash: hash, issuedAt: at(-7, 20, 7) },
    })
  }
  await audit({ tenantId: t, actorName: 'Marcos Vieira', actorRole: 'session_operator', action: 'voting.receipts_issued', aggregateType: 'voting', aggregateId: v1.id, summary: `Recibos verificáveis emitidos para os ${presentS1.length} votos nominais da votação do REQ 120.`, createdAt: at(-7, 20, 7) })

  // ── Fase 19: assinaturas do cidadão (dupla confirmação) ──────────
  const subs = [
    { tenantId: t, email: 'maria.aparecida.lopes@gmail.com', targetKind: 'matter', targetId: matters[`projeto_de_lei-47/${YEAR}`]!, confirmedAt: at(-4, 9), createdAt: at(-4, 8) },
    { tenantId: t, email: 'jose.ferreira@outlook.com', targetKind: 'matter', targetId: matters[`projeto_de_lei-47/${YEAR}`]!, confirmedAt: at(-3, 14), createdAt: at(-3, 13) },
    { tenantId: t, email: 'assoc.moradores.jp@gmail.com', targetKind: 'hearing', targetId: hearing1.id, confirmedAt: at(-2, 10), createdAt: at(-2, 9) },
    { tenantId: t, email: 'imprensa.local@vilanova.news', targetKind: 'session', targetId: s2.id, confirmedAt: null, createdAt: at(0, 8) },
    { tenantId: t2.id, email: 'cidadao@serraazul.sp.gov.br', targetKind: 'session', targetId: s2b.id, confirmedAt: at(-5, 11), createdAt: at(-5, 10) },
  ]
  for (const sub of subs) {
    await db.citizenSubscription.create({ data: { ...sub, token: randomUUID() } })
  }
  await audit({ tenantId: t, actorName: 'Paula Andrade', actorRole: 'legislative_admin', action: 'subscription.confirmed', aggregateType: 'citizen_subscription', summary: '3 assinaturas de cidadãos confirmadas (PL 47 e audiência do saneamento) — 1 aguardando confirmação.', createdAt: at(0, 9) })

  // ── Fase 20: suporte (impersonação encerrada), alertas e export ──
  const joaoPrado = await db.user.create({
    data: {
      name: 'João Prado',
      email: 'joao.prado@legissaas.dev',
      role: 'platform_support',
      jobTitle: 'Suporte da Plataforma',
      passwordHash: hashPassword(DEMO_PASSWORD),
    },
  })
  const anaUser = await db.user.findFirst({ where: { email: 'ana.ribeiro@vilanova.mg.leg.br' } })
  if (anaUser) {
    const imp = await db.supportImpersonation.create({
      data: { supportUserId: joaoPrado.id, targetUserId: anaUser.id, reason: 'Homologar fluxo de publicação relatado no ticket #1042 (ata não visível no portal).', expiresAt: at(-2, 11), startedAt: at(-2, 10), endedAt: at(-2, 10, 41) },
    })
    await audit({ tenantId: t, actorName: 'João Prado (Suporte)', actorRole: 'platform_support', action: 'support.impersonation_started', aggregateType: 'support_impersonation', aggregateId: imp.id, summary: 'Suporte iniciou operação como Ana Ribeiro (ticket #1042) — banner visível, prazo 60 min.', createdAt: at(-2, 10) })
    await audit({ tenantId: t, actorName: 'João Prado (Suporte)', actorRole: 'platform_support', action: 'support.impersonation_ended', aggregateType: 'support_impersonation', aggregateId: imp.id, summary: 'Impersonação encerrada após reprodução e correção orientada do fluxo de publicação.', createdAt: at(-2, 10, 41) })
  }
  await db.platformAlert.create({
    data: { kind: 'billing.invoice_overdue', severity: 'warning', message: 'Fatura 0002 do mês anterior da Câmara de Serra Azul segue vencida — ciclo de dunning pendente.', actionHint: 'Executar o ciclo de cobrança no Console → Faturamento ou registrar acordo.', meta: JSON.stringify({ tenantSlug: 'serra-azul' }), createdAt: at(0, 9) },
  })
  await db.platformAlert.create({
    data: { kind: 'outbox.lag', severity: 'info', message: 'Lag de 40 min no outbox durante a migração de segunda-feira — normalizado.', actionHint: 'Sem ação necessária (resolvido).', meta: JSON.stringify({ maxLagMinutes: 40 }), createdAt: at(-4, 16), ackAt: at(-4, 17), ackBy: 'Suporte Legis SaaS' },
  })
  await db.exportJob.create({
    data: { tenantId: t, status: 'done', progress: 100, createdAt: at(-3, 9), finishedAt: at(-3, 9, 2) },
  })

  // ── Onda 5: base das Fases 21–24 (ROADMAP §12) ────────────────────
  console.log('Onda 5: base das Fases 21–24…')

  // F21 — agendamentos (singleton por kind; scheduler :3005 assume no boot)
  const scheduledJobs = [
    { kind: 'alert.scan', title: 'Varredura de alertas de negócio', everySeconds: 300 },
    { kind: 'export.watchdog', title: 'Watchdog de exportações órfãs', everySeconds: 600 },
    { kind: 'health.check', title: 'Health check dos serviços', everySeconds: 300 },
    { kind: 'tenant.health_snapshot', title: 'Snapshot diário de saúde dos tenants', everySeconds: 86400 },
    { kind: 'notice.deadline_alerts', title: 'Avisos de prazo de convocação', everySeconds: 300 },
  ]
  for (const j of scheduledJobs) {
    await db.scheduledJob.create({
      data: {
        ...j,
        lastRunAt: new Date(Date.now() - 3600_000),
        nextRunAt: new Date(Date.now() + j.everySeconds * 1000),
        lastStatus: 'ok',
        lastNote: 'Execução nominal registrada na preparação da base.',
      },
    })
  }

  // F22 — assinaturas eletrônicas da ata publicada da sessão 1 (cadeia verificável)
  const ataDocHash = computeDocHash(pub1.contentMd)
  const ataSigners = presentS1.slice(0, 4) // mesa + primeiros presentes
  let prevSignatureHash: string | null = null
  for (const [i, name] of ataSigners.entries()) {
    const signedAt = at(-6, 11, i * 4)
    const { code, hash } = computeDocumentSignature(t, ataDocHash, parl[name].id, signedAt.toISOString())
    await db.documentSignature.create({
      data: {
        tenantId: t, kind: 'ata_sessao', documentId: pub1.id,
        signatoryParliamentarianId: parl[name].id, signatoryName: name,
        docHash: ataDocHash, prevHash: prevSignatureHash, signatureCode: code, signedAt,
      },
    })
    prevSignatureHash = hash
  }
  await audit({
    tenantId: t, actorName: 'Roberto Nogueira', actorRole: 'presiding_officer',
    action: 'ata.signed', aggregateType: 'document_signature', aggregateId: pub1.id,
    summary: `${ataSigners.length} parlamentares assinaram eletronicamente a Ata da 1ª Sessão Ordinária (cadeia de hash verificável — ADR-023).`,
    createdAt: at(-6, 11, 12),
  })

  // F23 — chaves de API demo (determinísticas p/ documentação e testes)
  const DEMO_API_KEY_VN = 'legk_vilanova7f3a9c21e5b8d406'
  await db.apiKey.create({
    data: {
      tenantId: t, name: 'Painel da Transparência',
      prefix: DEMO_API_KEY_VN.slice(0, 13), hash: sha256(DEMO_API_KEY_VN),
      scopes: JSON.stringify(['matters.read', 'sessions.read', 'publications.read']),
      lastUsedAt: at(-1, 10), createdAt: at(-6, 14),
    },
  })
  const DEMO_API_KEY_SA = 'legk_serraazul0c2e4a6813579bdf'
  await db.apiKey.create({
    data: {
      tenantId: t2.id, name: 'Integração legada (revogada)',
      prefix: DEMO_API_KEY_SA.slice(0, 13), hash: sha256(DEMO_API_KEY_SA),
      scopes: JSON.stringify(['sessions.read']),
      revokedAt: at(-2, 16), createdAt: at(-20, 9),
    },
  })

  // F24 — webhooks ativos (saúde do tenant + módulo Webhooks com dados demo)
  await db.webhookEndpoint.create({
    data: {
      tenantId: t, url: 'https://transparencia.vilanova.mg.gov.br/hooks/legis', secret: randomUUID(),
      events: JSON.stringify(['session.opened', 'voting.closed', 'matter.published']),
      description: 'Portal da Transparência — sincronização de sessões e votações', createdAt: at(-25, 10),
    },
  })
  await db.webhookEndpoint.create({
    data: {
      tenantId: t, url: 'https://crm.vilanova.mg.leg.br/legis-webhook', secret: randomUUID(),
      events: JSON.stringify(['matter.published', 'publication.published']),
      description: 'CRM institucional — matérias e publicações', createdAt: at(-12, 15),
    },
  })

  // F24 — logins dos últimos 30d na auditoria (alimenta o health score — auth.login)
  const loginSeeds: Array<[string, string, number]> = [
    ['Ana Ribeiro', 'tenant_admin', 4],
    ['Paula Andrade', 'legislative_admin', 3],
    ['Marcos Vieira', 'session_operator', 3],
    ['Roberto Nogueira', 'presiding_officer', 2],
    ['Carla Mendes', 'parliamentarian', 1],
  ]
  for (const [name, role, count] of loginSeeds) {
    for (let i = 0; i < count; i++) {
      await audit({
        tenantId: t, actorName: name, actorRole: role, action: 'auth.login', aggregateType: 'user',
        summary: `Login por senha — ${name}`, createdAt: at(-((i * 5) % 26) - 1, 8 + (i % 9)),
      })
    }
  }
  for (let i = 0; i < 2; i++) {
    await audit({
      tenantId: t2.id, actorName: 'Marta Lima', actorRole: 'tenant_admin', action: 'auth.login', aggregateType: 'user',
      summary: 'Login por senha — Marta Lima', createdAt: at(-(i * 9) - 2, 9 + i),
    })
  }

  // F24 — trial do tenant 2 e snapshots de health (fórmula canônica → determinístico)
  await db.tenant.update({ where: { id: t2.id }, data: { trialEndsAt: at(7, 12) } })
  const t2Row = await db.tenant.findUnique({ where: { id: t2.id }, select: { id: true, name: true, slug: true } })
  for (const row of [await db.tenant.findUnique({ where: { id: t }, select: { id: true, name: true, slug: true } }), t2Row]) {
    if (!row) continue
    const health = await computeTenantHealth(db, row)
    await db.tenantHealthSnapshot.create({
      data: { tenantId: row.id, score: health.score, metrics: JSON.stringify(health.metrics), capturedAt: at(-1, 4) },
    })
  }
  await db.onboardingRequest.create({
    data: {
      chamberName: 'Câmara Municipal de Alto Horizonte', city: 'Alto Horizonte', uf: 'MG',
      email: 'contato@altohorizonte.mg.leg.br', slug: 'alto-horizonte', createdAt: at(-1, 15),
    },
  })
  await db.onboardingRequest.create({
    data: {
      chamberName: 'Câmara Municipal de Porto Verde', city: 'Porto Verde', uf: 'GO',
      email: 'diretoria@portoverde.go.leg.br', slug: 'porto-verde', status: 'rejeitada',
      note: 'Município atendido pela versão legada — migrar via importador antes de ativar o trial (ticket #1121).',
      createdAt: at(-8, 10),
    },
  })
  const npsSeeds: Array<{ email: string; score: number; comment?: string }> = [
    { email: 'ana.ribeiro@vilanova.mg.leg.br', score: 9, comment: 'Fluxo de sessão e votação economizou horas da equipe.' },
    { email: 'carla.mendes@vilanova.mg.leg.br', score: 10 },
    { email: 'paula.andrade@vilanova.mg.leg.br', score: 7, comment: 'Faltam atalhos no protocolo, mas o dia a dia melhorou muito.' },
  ]
  for (const n of npsSeeds) {
    const u = await db.user.findFirst({ where: { email: n.email } })
    if (u) {
      await db.npsResponse.create({ data: { userId: u.id, role: u.role, score: n.score, comment: n.comment ?? null, version: '0.13.0' } })
    }
  }

  // ── v0.13.0: Planejamento e Roadmap — Onda 5 ENTREGUE (ROADMAP §12) ───────
  // Flip v0.13.0: fases com status 'entregue' e tasks 'concluido' (34/34) —
  // o progresso real da Onda 5 fechada; PATCH do owner segue disponível.
  const roadmapPhases: Array<{ code: string; wave: string; name: string; period: string; objective: string; status: string; order: number; tasks: Array<[string, string]> }> = [
    {
      code: 'F21', wave: 'Onda 5', name: 'Prontidão para produção', period: 'v0.13.0',
      objective: 'Tarefas agendadas verificáveis (alertas, health, watchdog), grafo de matérias livre de ciclos e esteira de CI.',
      status: 'entregue', order: 1,
      tasks: [
        ['Mini-serviço scheduler (porta 3005, tick 30s) lendo ScheduledJob no SQLite', 'Mesmo padrão do realtime/outbox (ADR-003); grava lastRunAt/lastStatus/nextRunAt a cada execução.'],
        ['Modelo ScheduledJob + GET /platform/schedules', 'Singleton por kind (alert.scan, export.watchdog, health.check, tenant.health_snapshot); leitura platform.read.'],
        ['Run manual e pausar/retomar agendamentos', 'POST /platform/schedules/:id/run e PATCH /platform/schedules/:id (platform.manage); execução manual não adianta nextRunAt.'],
        ['Varredura de alertas (alert.scan)', 'Fatura vencida > 3d, sessão ≤ 48h sem pauta, webhook em dead-letter → PlatformAlert deduplicada por kind aberto.'],
        ['Watchdog de export jobs órfãos', 'ExportJob em running > 10 min → failed + alerta persistente (pendência real da Onda 4).'],
        ['Health check agendado (health.check)', 'Ping socket.io (3003), webhooks (3004) e banco → alerta de degradação com actionHint.'],
        ['Validação de ciclos em relacionamentos de matérias', 'DFS bidirecional (profundidade 50) no POST /matters/:id/related → 422 MATTER_CYCLE com o caminho encontrado.'],
        ['CI (GitHub Actions) e caminho de produção', 'ci.yml com lint + tsc + smoke; ADR-022 registra PostgreSQL+RLS, Redis, SMTP e worker dedicado.'],
      ],
    },
    {
      code: 'F22', wave: 'Onda 5', name: 'Confiança de acesso e assinatura eletrônica', period: 'v0.13.0',
      objective: 'Login com MFA TOTP, gestão de sessões ativas e atas assinadas eletronicamente com cadeia de hash verificável publicamente.',
      status: 'entregue', order: 2,
      tasks: [
        ['TOTP nativo (RFC 6238) com node:crypto', 'HMAC-SHA1 de 30s com janela ±1, sem dependência externa (lib/server).'],
        ['Setup/habilitação/desabilitação de MFA', 'POST /auth/mfa/setup (otpauth://), enable com código válido, disable com senha + código; segredo nunca retornado após enable.'],
        ['Login em dois passos', 'Senha correta com MFA ativo → 401 MFA_REQUIRED sem sessão; POST /auth/login/mfa valida o código e emite a sessão.'],
        ['Gestão de sessões ativas do usuário', 'GET/DELETE /auth/sessions (dispositivo, último uso, encerrar individual).'],
        ['Modelo DocumentSignature com cadeia de hash', 'docHash = sha256 da ata publicada; prevHash da última assinatura; signatureCode = HMAC do tenant [:16] (padrão ADR-019).'],
        ['Assinatura da ata pelo parlamentar', 'POST /me/ata/sign (idempotente por documento+signatário) via App do Parlamentar com 1 toque.'],
        ['Painel de assinaturas em Relatórios', 'Presentes na sessão, assinaram, pendentes e integridade da cadeia (GET /reports/session/:id/ata/signatures).'],
        ['Verificação pública das assinaturas no Portal', 'GET /public/documents/ata/:sessionId e verify-signature?code= (rate limited); ata atesta presença, nunca o voto.'],
        ['ADR-023 (MFA sandbox + assinatura eletrônica)', 'Caminho de produção: OIDC/SAML e ICP-Brasil; drift e revogação documentados.'],
      ],
    },
    {
      code: 'F23', wave: 'Onda 5', name: 'Ecossistema: chaves de API', period: 'v0.13.0',
      objective: 'Acesso programático autenticado, escopado e limitado para integradores, com playground real e documentação de desenvolvedor.',
      status: 'entregue', order: 3,
      tasks: [
        ['Modelo ApiKey (prefixo legk_, hash, escopos)', 'Chave completa exibida UMA vez; só o sha256 persiste; revogação append-only.'],
        ['Permissão apikey.manage + rotas de gestão', 'GET/POST /api-keys e DELETE /api-keys/:id (tenant_admin; auditoria apikey.revoked).'],
        ['Rotas externas /external/{matters,sessions,publications,calendar}', 'Bearer legk_…; escopo derivado da chave (mesmo isolamento do x-actor-id).'],
        ['Rate limit por chave (60/min, 429 + Retry-After)', 'Janela deslizante em memória (produção: Redis); lastUsedAt best-effort sem log de IP (LGPD).'],
        ['Módulo Integrações & API — aba Chaves', 'Tabela com prefixo/escopos/último uso, dialog de criação com escopos, revogação com AlertDialog.'],
        ['Playground de API', 'Seleção de endpoint + chave → consulta REAL server-side (chave nunca exposta ao browser) com JSON, status e latência.'],
        ['Aba Documentação + guia do desenvolvedor na Central de Ajuda', 'Referência dos endpoints externos, exemplos curl, Problem Details e limites.'],
        ['ADR-024 (escopos mínimos e revogação imediata)', 'Sem chave → 401; escopo ausente → 403 com code; chave nunca logada.'],
      ],
    },
    {
      code: 'F24', wave: 'Onda 5', name: 'Crescimento do SaaS', period: 'v0.13.0',
      objective: 'Self-onboarding com trial de 14 dias, health score anti-churn, métricas de negócio (MRR/churn) e NPS in-app.',
      status: 'entregue', order: 4,
      tasks: [
        ['Modelo OnboardingRequest + POST público /public/onboarding', 'Rate limited 3/h/IP; valida slug, e-mail e UF; cria pedido pendente.'],
        ['Ativação de trial pela plataforma', 'POST /platform/onboarding/:id/activate (platform.manage) cria tenant +14d e owner com senha temporária exibida UMA vez.'],
        ['Tenant.trialEndsAt + entitlements de trial', 'Trial = plano profissional por 14 dias (entitlements reutilizados da Fase 10).'],
        ['Bloqueio suave pós-expiração', 'Escrita do tenant → 403 TRIAL_EXPIRED; leitura liberada; banner no topbar com dias restantes/expirado.'],
        ['Health score por tenant + snapshot diário', 'Métricas 30d (sessões, matérias, logins, webhooks ativos) → score 0–100 e buckets; captura pelo scheduler (F21).'],
        ['Métricas SaaS: GET /platform/metrics', 'MRR simulado (planos ativos × preço), churn 90d, tenants ativos, trials e NPS médio (platform.read).'],
        ['NPS in-app idempotente', 'POST /help/nps (0–10 + comentário) por usuário/versão; consolidação agregada em /platform/nps.'],
        ['Módulo/aba Crescimento (platform_owner)', 'Cards de negócio, tabela de health com tendência e fila de pedidos de onboarding (ativar/rejeitar).'],
        ['ADR-025 (self-onboarding com revisão humana)', 'Gateway de pagamento real como caminho de produção; LGPD e NPS agregado.'],
      ],
    },
  ]
  for (const ph of roadmapPhases) {
    await db.roadmapPhase.create({ data: { code: ph.code, wave: ph.wave, name: ph.name, period: ph.period, objective: ph.objective, status: ph.status, order: ph.order } })
    for (const [i, [title, detail]] of ph.tasks.entries()) {
      await db.roadmapTask.create({ data: { phaseCode: ph.code, title, detail, order: i + 1, status: 'concluido' } })
    }
  }

  console.log(`  Tenant 2: ${t2.slug} (plano starter em trial — sem ai_assist)`)
  console.log(`  Parlamentares: ${parlData.length} + ${parl2Data.length}`)
  console.log(`  Matérias: ${matterData.length} + ${matter2Data.length}`)
  console.log(`  Sessões: 3 + 2 (tenant 2: 1 encerrada com votação, 1 futura) — ano ${YEAR}`)
  console.log(`  Fases 9–12: senhas demo (${DEMO_PASSWORD}), 5 faturas (1 vencida), 5 publicações (1 revogada), 3 audiências (1 aberta com 4 perguntas)`)
  console.log(`  Fases 13–16: ${templatesSeed.length} modelos (Vila Nova) + 1 (Serra Azul), agenda/pesquisa/ajuda/observabilidade nos módulos`)
  console.log('  Onda 4: sanção (PL 41) + veto total (PL 49) + emenda vinculada, votação com opções regimentais, recibos do REQ 120, 5 assinaturas de cidadãos, usuário de suporte, 2 alertas e 1 export concluído')
  console.log('  Onda 5 (base): 4 agendamentos, 4 assinaturas eletrônicas da ata (cadeia ADR-023), 2 chaves de API (1 revogada), trial Serra Azul +7d, 2 webhooks + 15 logins, snapshots de health determinísticos, 2 pedidos de onboarding e 3 NPS')
  console.log('  v0.13.0: Planejamento e Roadmap — Onda 5 (F21–F24) ENTREGUE: 4 fases entregues e 34/34 tasks concluídas')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
