/**
 * v0.13.0 — Conteúdo do módulo "Planejamento e Roadmap" (ROADMAP §12/§13).
 *
 * Parte estática (estado entregue, mapa-alvo TO-BE v5, pacote documental,
 * prévia da Onda 6 e ordem de execução) versionada com o código — mesmo padrão
 * da Central de Ajuda (ADR-016). As FASES e TASKS vêm do banco
 * (RoadmapPhase/RoadmapTask) para que o progresso seja rastreável de verdade:
 * PATCH /api/v1/roadmap/tasks/:id (platform.manage) persiste status + autor.
 *
 * O conteúdo reflete o plano REAL de docs/ROADMAP.md (§12–§14) e o estado
 * entregue das Ondas 1–5 (v0.13.0 — Onda 5 CLOSED: 34/34 tasks concluídas).
 * Qualquer papel autenticado LÊ; apenas o platform_owner altera o progresso
 * (RBAC server-side).
 */
import { db } from '@/lib/db'
import type {
  RoadmapContent,
  RoadmapDeliveredWave,
  RoadmapDocItem,
  RoadmapMenuGroup,
  RoadmapPhaseView,
  RoadmapPreviewPhase,
  RoadmapTaskView,
} from '@/lib/contracts'

// ─── Estado entregue (Ondas 1–4) ─────────────────────────────────────────────

const DELIVERED: RoadmapDeliveredWave[] = [
  {
    wave: 'Onda 1',
    phases: 'Fases 0–4',
    version: 'v0.1.0',
    summary:
      'Fundação multi-tenant (white-label, RBAC, auditoria hash chain, outbox/tempo real), estrutura básica de parlamentares e matérias, motor completo de sessão/votação/presença/quórum, discursos com timer, telão kiosk, portal live e relatórios.',
  },
  {
    wave: 'Onda 2',
    phases: 'Fases 5–8',
    version: 'v0.2.0 → v0.5.0',
    summary:
      'Estrutura institucional completa (legislaturas, Mesa, comissões, partidos/blocos, mandatos), protocolo e tramitação, portal público completo com dados abertos, notificações e webhooks HMAC, atas, IA assistiva com revisão humana, PWA do parlamentar (/me), console SaaS e importador de migração.',
  },
  {
    wave: 'Onda 3',
    phases: 'Fases 9–16',
    version: 'v0.9.0 / v0.10.0',
    summary:
      'Autenticação real (senhas scrypt, sessões, verificação), faturamento e ciclo comercial do SaaS, publicações oficiais e audiências com perguntas, Analytics/BI; depois Agenda Legislativa + pesquisa unificada (⌘K), modelos de documento versionados, Central de Ajuda in-app e observabilidade/exportação/encerramento.',
  },
  {
    wave: 'Onda 4',
    phases: 'Fases 17–20',
    version: 'v0.11.0',
    summary:
      'Ciclo pós-aprovação (relacionamentos, emendas, sanção/veto com prazo), votações com opções regimentais e recibos HMAC verificáveis, participação do cidadão (assinaturas com dupla confirmação, verificação pública, rate limit), suporte com impersonação auditada, alertas persistentes e exportação assíncrona com progresso.',
  },
  {
    wave: 'Onda 5',
    phases: 'Fases 21–24',
    version: 'v0.13.0',
    summary:
      'Prontidão para produção (agendador :3005 com tick 30s, watchdog de exportações, validação de ciclos de matérias, CI), confiança de acesso (MFA TOTP, sessões ativas com revogação, assinatura eletrônica de atas com cadeia de hash e verificação pública), ecossistema (chaves de API legk_ com escopos, rotas externas /external, playground real) e crescimento do SaaS (self-onboarding com trial, health score anti-churn, métricas MRR/churn, NPS in-app) — 26 módulos, ~92 grupos de rotas, 25 ADRs.',
  },
]

// ─── Mapa-alvo TO-BE v5 (26 módulos) — ROADMAP §12.0 ─────────────────────────

const MENU_V5: RoadmapMenuGroup[] = [
  {
    group: 'Operação',
    items: [
      { label: 'Painel', state: 'existente' },
      { label: 'Agenda Legislativa', state: 'existente' },
      { label: 'Sessões', state: 'existente' },
      { label: 'Mesa do Plenário', state: 'estendido', note: 'coleta de assinaturas da ata no encerramento — Fase 22' },
      { label: 'Telão', state: 'existente' },
      { label: 'App do Parlamentar (PWA)', state: 'estendido', note: '"Assinar ata" da sessão encerrada — Fase 22' },
    ],
  },
  {
    group: 'Processo Legislativo',
    items: [{ label: 'Protocolo e Tramitação', state: 'estendido', note: 'validação de ciclos ao vincular matérias — Fase 21' }],
  },
  {
    group: 'Cadastros',
    items: [
      { label: 'Parlamentares', state: 'existente' },
      { label: 'Matérias', state: 'estendido', note: 'rejeição de ciclo em relacionamentos — Fase 21' },
      { label: 'Estrutura Institucional', state: 'existente' },
    ],
  },
  {
    group: 'Governança',
    items: [
      { label: 'Auditoria', state: 'existente' },
      { label: 'Relatórios', state: 'estendido', note: 'painel de assinaturas da ata — Fase 22' },
      { label: 'Publicações e Audiências', state: 'existente' },
      { label: 'Analytics', state: 'existente' },
      { label: 'Portal Público', state: 'estendido', note: 'verificação pública de assinaturas da ata — Fase 22' },
      { label: 'Webhooks', state: 'existente' },
      { label: 'Integrações & API', state: 'novo', note: 'chaves de API com escopos, playground real e referência — Fase 23' },
    ],
  },
  {
    group: 'Administração',
    items: [
      { label: 'Usuários', state: 'estendido', note: 'MFA por usuário e sessões ativas — Fase 22' },
      { label: 'Modelos de Documento', state: 'existente' },
      { label: 'Configurações', state: 'existente' },
      { label: 'Console da Plataforma', state: 'estendido', note: 'abas Agendamentos (F21) e Crescimento (F24)' },
      { label: 'Migração de Dados', state: 'existente' },
      { label: 'Suporte da Plataforma', state: 'estendido', note: 'watchdog de jobs órfãos — Fase 21' },
      { label: 'Planejamento e Roadmap', state: 'novo', note: 'entregue na v0.12.0 — este módulo' },
      { label: 'Crescimento', state: 'novo', note: 'health score, MRR/churn, trials e NPS — Fase 24' },
    ],
  },
  {
    group: 'Ajuda',
    items: [
      { label: 'Central de Ajuda', state: 'estendido', note: 'guia do desenvolvedor de API (F23) e widget NPS (F24)' },
    ],
  },
]

// ─── Pacote documental do sistema (entregue + planejado) — ROADMAP §8 ────────

const DOCS: RoadmapDocItem[] = [
  { name: 'README.md', path: 'README.md', content: 'Visão geral, stack, como executar, índice da documentação', status: 'entregue', phase: 'Contínuo' },
  { name: 'ROADMAP.md', path: 'docs/ROADMAP.md', content: 'Documento-mestre de continuidade: estado, ondas, mapa-alvo e ordem de execução', status: 'entregue', phase: 'Contínuo' },
  { name: 'Contrato de API', path: 'docs/api-contract.md', content: 'Contrato REST completo + matriz RBAC + eventos (~92 grupos de rotas)', status: 'entregue', phase: 'Contínuo' },
  { name: 'ADR-001..009', path: 'docs/adr/', content: 'Arquitetura sandbox, motor de sessão/votação, outbox, auditoria hash chain, RBAC, IA, webhooks, importador, PWA', status: 'entregue', phase: 'Ondas 1–2' },
  { name: 'ADR-010..013', path: 'docs/adr/', content: 'Autenticação real, faturamento simulado, publicações/participação, analytics somente-leitura', status: 'entregue', phase: 'Fases 9–12' },
  { name: 'ADR-014..017', path: 'docs/adr/', content: 'Agenda/pesquisa, modelos versionados, Central de Ajuda, observabilidade/lifecycle do tenant', status: 'entregue', phase: 'Fases 13–16' },
  { name: 'ADR-018..021', path: 'docs/adr/', content: 'Desfechos da matéria, recibos verificáveis, participação/confiança pública, suporte/impersonação', status: 'entregue', phase: 'Onda 4' },
  { name: 'Manual do usuário', path: 'docs/user-manual.md', content: 'Por perfil (operador, presidência, admin, auditor, parlamentar, plataforma) — todos os módulos', status: 'entregue', phase: 'Contínuo' },
  { name: 'Runbook operacional', path: 'docs/runbook.md', content: 'Ambiente, health checks, backup/restauração, restart, troubleshooting, suporte/impersonação e export', status: 'entregue', phase: 'Contínuo' },
  { name: 'CHANGELOG', path: 'docs/CHANGELOG.md', content: 'Notas de release por fase (Keep a Changelog) — v0.1.0 → v0.13.0', status: 'entregue', phase: 'Contínuo' },
  { name: 'Relatório de testes', path: 'docs/test-report.md', content: 'Evidências reais (curl + agent-browser), falhas corrigidas e riscos remanescentes', status: 'entregue', phase: 'Contínuo' },
  { name: 'Guia do importador', path: 'docs/migration-importer.md', content: 'Fontes, estágios, homologação e rollback da migração', status: 'entregue', phase: 'Fase 8' },
  { name: 'ADR-022 — Prontidão para produção', path: 'docs/adr/ADR-022-prontidao-producao.md', content: 'Agendador/watchdog no sandbox; caminho para PostgreSQL+RLS, Redis, SMTP e worker dedicado', status: 'entregue', phase: 'F21' },
  { name: 'ADR-023 — MFA e assinatura eletrônica', path: 'docs/adr/ADR-023-confianca-acesso-assinatura.md', content: 'TOTP nativo, sessões, cadeia de hash de assinaturas; caminho para OIDC/SAML e ICP-Brasil', status: 'entregue', phase: 'F22' },
  { name: 'ADR-024 — Chaves de API', path: 'docs/adr/ADR-024-ecossistema-api-keys.md', content: 'Escopos mínimos de leitura, rate limit por chave, revogação imediata e LGPD', status: 'entregue', phase: 'F23' },
  { name: 'ADR-025 — Crescimento do SaaS', path: 'docs/adr/ADR-025-crescimento-saas.md', content: 'Self-onboarding com revisão humana, trial, health score, NPS agregado; gateway real como caminho', status: 'entregue', phase: 'F24' },
]

// ─── Onda 6 — prévia (ROADMAP §13) ───────────────────────────────────────────

const WAVE_6: RoadmapPreviewPhase[] = [
  { code: 'F25', name: 'Produção real (infraestrutura)', summary: 'PostgreSQL+RLS, Redis, S3, SMTP, worker dedicado, CI completo com testes e deploy blue-green.' },
  { code: 'F26', name: 'Identidade federada e cripto de confiança', summary: 'OIDC/SAML, voto secreto criptográfico (mixnet/assinatura cega), ICP-Brasil, HSM/KMS por tenant.' },
  { code: 'F27', name: 'Multi-idioma e acessibilidade AA', summary: 'pt-BR/en/es, auditoria WCAG 2.1 AA (telão e PWA), narrativa de áudio para baixa visão.' },
  { code: 'F28', name: 'Ecossistema amplo', summary: 'Marketplace de integrações, agente Tauri offline com sync por snapshot, dados abertos CKAN, GraphQL opcional.' },
]

// ─── Ordem de execução (ROADMAP §12.5) ──────────────────────────────────────

const EXECUTION: RoadmapContent['execution'] = [
  { task: '32', phase: 'Planejamento da Onda 5 + módulo Planejamento e Roadmap (v0.12.0)', executor: 'main', status: 'concluída' },
  { task: '33-a', phase: 'UI completa do módulo (abas: visão, fases, mapa, documentação, Onda 6)', executor: 'subagente', status: 'concluída' },
  { task: '33-b', phase: 'Pacote de documentação v0.12.0 (CHANGELOG, manual, ajuda, README, runbook, testes)', executor: 'subagente', status: 'concluída' },
  { task: '34', phase: 'Base da Onda 5: schema + contracts + RBAC + sidebar (26 módulos) + seed', executor: 'main', status: 'concluída' },
  { task: '34-a', phase: 'Fase 21 — Agendador, watchdog, ciclos e CI', executor: 'subagente', status: 'concluída' },
  { task: '34-b', phase: 'Fase 22 — MFA, sessões e assinatura eletrônica de atas', executor: 'subagente', status: 'concluída' },
  { task: '35-a', phase: 'Fase 23 — Chaves de API, rotas externas e playground', executor: 'subagente', status: 'concluída' },
  { task: '35-b', phase: 'Fase 24 — Onboarding, trial, health e NPS', executor: 'subagente', status: 'concluída' },
  { task: '36', phase: 'Integração final, reseed e lint', executor: 'main', status: 'concluída' },
  { task: '37', phase: 'Verificação E2E (3 correções de integração) + ADRs 022–025 + documentação v0.13.0', executor: 'main + docs', status: 'concluída' },
]

// ─── Montagem ────────────────────────────────────────────────────────────────

function toTaskView(t: {
  id: string
  phaseCode: string
  title: string
  detail: string
  status: string
  order: number
  updatedByName: string | null
  updatedAt: Date | null
}): RoadmapTaskView {
  return {
    id: t.id,
    phaseCode: t.phaseCode,
    title: t.title,
    detail: t.detail,
    status: t.status as RoadmapTaskView['status'],
    order: t.order,
    updatedByName: t.updatedByName,
    updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
  }
}

export async function buildRoadmapContent(): Promise<RoadmapContent> {
  const [phaseRows, taskRows] = await Promise.all([
    db.roadmapPhase.findMany({ orderBy: { order: 'asc' } }),
    db.roadmapTask.findMany({ orderBy: [{ phaseCode: 'asc' }, { order: 'asc' }] }),
  ])

  const phases: RoadmapPhaseView[] = phaseRows.map((p) => {
    const tasks = taskRows.filter((t) => t.phaseCode === p.code).map(toTaskView)
    const done = tasks.filter((t) => t.status === 'concluido').length
    const total = tasks.length
    return {
      code: p.code,
      wave: p.wave,
      name: p.name,
      period: p.period,
      objective: p.objective,
      status: p.status,
      order: p.order,
      tasks,
      progress: { done, total, percent: total ? Math.round((done / total) * 100) : 0 },
    }
  })

  return {
    meta: {
      currentVersion: '0.13.0',
      plannedVersion: '0.14.0',
      module: 'Planejamento e Roadmap',
      modules: 26,
      routeGroups: 92,
      adrs: 25,
      miniServices: ['realtime :3003', 'webhooks :3004', 'scheduler :3005', 'gateway Caddy'],
      source: 'docs/ROADMAP.md §12–§14',
    },
    delivered: DELIVERED,
    phases,
    menuV5: MENU_V5,
    docs: DOCS,
    wave6: WAVE_6,
    execution: EXECUTION,
  }
}
