/**
 * Motor do importador de migração (Fase 8) — pipeline auditável de 8 estágios:
 * inspect → validate → plan → dry_run → import → reconcile → report → rollback.
 *
 * Regras invioláveis (ROADMAP §6.3):
 * - O ID legado JAMAIS vira PK nova: tudo passa por MigrationMapping.
 * - Conflitos nunca são resolvidos silenciosamente — viram MigrationIssue.
 * - Voto/presença/resultado ausente NUNCA é deduzido — vira issue para homologação.
 * - Import sempre no tenant do ator; rollback remove SOMENTE dados do run.
 */
import { createHash } from 'crypto'
import type { Prisma, MigrationRun } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'
import { DomainError } from '@/lib/server/errors'
import type { ResolvedActor } from '@/lib/server/actor'
import {
  readLegacySource,
  parseLegacyDate,
  type LegacySource,
  type LegacyParlamentar,
  type LegacyPresenca,
  type LegacyVotacao,
  type LegacyVoto,
} from './legacy-source'

type Tx = Prisma.TransactionClient

export type MigrationStage = 'inspect' | 'validate' | 'plan' | 'dry_run' | 'import' | 'reconcile' | 'report' | 'rollback'

export const MIGRATION_STAGES: MigrationStage[] = ['inspect', 'validate', 'plan', 'dry_run', 'import', 'reconcile', 'report', 'rollback']

/** Estágio predecessor exigido para executar cada estágio (null = cria run). */
const PREVIOUS_STAGE: Record<MigrationStage, MigrationStage | null> = {
  inspect: null,
  validate: 'inspect',
  plan: 'validate',
  dry_run: 'plan',
  import: 'dry_run',
  reconcile: 'import',
  report: 'reconcile',
  // rollback após dry_run+: remove o que o run gravou (se import não ocorreu,
  // apenas encerra a execução — cancelamento de pipeline preparado).
  rollback: 'dry_run',
}

// ─── Mapas de domínio legado → novo ────────────────────────────────────────

export const MATERIA_STATUS_MAP: Record<string, string> = {
  EM_TRAMITACAO: 'em_tramitacao',
  APROVADA: 'aprovado',
  REJEITADA: 'rejeitado',
  ARQUIVADA: 'arquivado',
  PAUTA: 'incluida_pauta',
}
export const MATERIA_TYPE_MAP: Record<string, string> = {
  PROJETO_LEI: 'projeto_de_lei',
  REQUERIMENTO: 'requerimento',
  INDICACAO: 'indicacao',
  MOCAO: 'mocao',
  DECRETO_LEGISLATIVO: 'decreto_legislativo',
  EMENDA: 'emenda',
}
export const SESSAO_TYPE_MAP: Record<string, string> = {
  ORDINARIA: 'ordinaria',
  EXTRAORDINARIA: 'extraordinaria',
  SOLENE: 'solene',
  ESPECIAL: 'especial',
}
export const VOTACAO_MODE_MAP: Record<string, string> = {
  NOMINAL: 'nominal',
  SIMBOLICA: 'simbolico',
  SECRETA: 'secreto',
}
export const RESULTADO_MAP: Record<string, string> = {
  APROVADA: 'aprovado',
  REJEITADA: 'rejeitado',
  EMPATE: 'empate',
  ANULADA: 'anulado',
}
export const CARGO_MESA_MAP: Record<string, string> = {
  PRESIDENTE: 'presidente',
  VICE_PRESIDENTE: 'vice_presidente',
  PRIMEIRO_SECRETARIO: 'primeiro_secretario',
  SEGUNDO_SECRETARIO: 'vereador',
  VEREADOR: 'vereador',
}
export const VOTO_MAP: Record<string, string> = {
  SIM: 'sim',
  NAO: 'nao',
  ABSTENCAO: 'abstencao',
}

// ─── Análise da fonte (pura, compartilhada pelos estágios) ─────────────────

export type SourceAnalysis = {
  source: LegacySource
  rowsTotal: number
  rowsPerTable: Record<string, number>
  orphanPresencas: Array<{ p: LegacyPresenca; reason: string }>
  duplicatePresencas: LegacyPresenca[]
  validPresencas: LegacyPresenca[]
  orphanVotacoes: Array<{ v: LegacyVotacao; reason: string }>
  validVotacoes: LegacyVotacao[]
  orphanVotos: Array<{ v: LegacyVoto; reason: string }>
  nullVotos: LegacyVoto[]
  votesOfRejectedVotacoes: LegacyVoto[]
  importableVotos: LegacyVoto[]
  invertedSessoes: string[]
  validSessoes: Array<{ s: LegacySource['sessoes'][number]; inverted: boolean }>
  validProposicoes: LegacySource['proposicoes']
  validParlamentares: LegacyParlamentar[]
  unknownDomain: Array<{ table: string; id: string; field: string; value: string }>
  presentCountBySession: Record<string, number>
  expected: Record<string, number>
}

export function analyzeSource(source: LegacySource): SourceAnalysis {
  const parlIds = new Set(source.parlamentares.map((p) => p.id))
  const propIds = new Set(source.proposicoes.map((p) => p.id))
  const sessIds = new Set(source.sessoes.map((s) => s.id))
  const votIds = new Set(source.votacoes.map((v) => v.id))

  const unknownDomain: SourceAnalysis['unknownDomain'] = []

  // Presenças: órfãs (fk inexistente) + duplicidade de pk
  const seenPres = new Set<string>()
  const orphanPresencas: SourceAnalysis['orphanPresencas'] = []
  const duplicatePresencas: LegacyPresenca[] = []
  const validPresencas: LegacyPresenca[] = []
  for (const p of source.presencas) {
    if (!sessIds.has(p.sessao_id)) {
      orphanPresencas.push({ p, reason: `sessão ${p.sessao_id} inexistente no export` })
      continue
    }
    if (!parlIds.has(p.parlamentar_id)) {
      orphanPresencas.push({ p, reason: `parlamentar ${p.parlamentar_id} inexistente no export` })
      continue
    }
    if (seenPres.has(p.id)) {
      duplicatePresencas.push(p)
      continue
    }
    seenPres.add(p.id)
    validPresencas.push(p)
  }

  // Votações: órfãs + domínio desconhecido
  const orphanVotacoes: SourceAnalysis['orphanVotacoes'] = []
  const validVotacoes: LegacyVotacao[] = []
  for (const v of source.votacoes) {
    if (!sessIds.has(v.sessao_id)) {
      orphanVotacoes.push({ v, reason: `sessão ${v.sessao_id} inexistente no export` })
      continue
    }
    if (!propIds.has(v.proposicao_id)) {
      orphanVotacoes.push({ v, reason: `proposição ${v.proposicao_id} inexistente no export` })
      continue
    }
    if (!VOTACAO_MODE_MAP[v.modo_legado]) {
      unknownDomain.push({ table: 'votacoes', id: v.id, field: 'modo_legado', value: v.modo_legado })
      continue
    }
    if (!RESULTADO_MAP[v.resultado_legado]) {
      unknownDomain.push({ table: 'votacoes', id: v.id, field: 'resultado_legado', value: v.resultado_legado })
      continue
    }
    validVotacoes.push(v)
  }
  const validVotIds = new Set(validVotacoes.map((v) => v.id))

  // Votos: órfãos, "NULL" legado e votos de votações rejeitadas
  const orphanVotos: SourceAnalysis['orphanVotos'] = []
  const nullVotos: LegacyVoto[] = []
  const votesOfRejectedVotacoes: LegacyVoto[] = []
  const importableVotos: LegacyVoto[] = []
  for (const voto of source.votos) {
    if (!votIds.has(voto.votacao_id)) {
      orphanVotos.push({ v: voto, reason: `votação ${voto.votacao_id} inexistente no export` })
      continue
    }
    if (!validVotIds.has(voto.votacao_id)) {
      votesOfRejectedVotacoes.push(voto)
      continue
    }
    if (!parlIds.has(voto.parlamentar_id)) {
      orphanVotos.push({ v: voto, reason: `parlamentar ${voto.parlamentar_id} inexistente no export` })
      continue
    }
    if (voto.voto === 'NULL') {
      nullVotos.push(voto)
      continue
    }
    if (!VOTO_MAP[voto.voto]) {
      unknownDomain.push({ table: 'votos', id: voto.id, field: 'voto', value: voto.voto })
      continue
    }
    importableVotos.push(voto)
  }

  // Sessões: datas inválidas/invertidas + domínio
  const invertedSessoes: string[] = []
  const validSessoes: SourceAnalysis['validSessoes'] = []
  for (const s of source.sessoes) {
    const abertura = parseLegacyDate(s.data_abertura)
    const encerramento = parseLegacyDate(s.data_encerramento)
    if (!abertura || !encerramento) {
      unknownDomain.push({ table: 'sessoes', id: s.id, field: 'data', value: `${s.data_abertura} → ${s.data_encerramento}` })
      continue
    }
    if (!SESSAO_TYPE_MAP[s.tipo_legado]) {
      unknownDomain.push({ table: 'sessoes', id: s.id, field: 'tipo_legado', value: s.tipo_legado })
      continue
    }
    const inverted = encerramento.getTime() < abertura.getTime()
    if (inverted) invertedSessoes.push(s.id)
    validSessoes.push({ s, inverted })
  }

  // Proposições: domínio
  const validProposicoes = source.proposicoes.filter((pr) => {
    if (!MATERIA_TYPE_MAP[pr.tipo]) {
      unknownDomain.push({ table: 'proposicoes', id: pr.id, field: 'tipo', value: pr.tipo })
      return false
    }
    if (!MATERIA_STATUS_MAP[pr.situacao_legado]) {
      unknownDomain.push({ table: 'proposicoes', id: pr.id, field: 'situacao_legado', value: pr.situacao_legado })
      return false
    }
    return true
  })

  // Presentes por sessão (presenças válidas com presente=1)
  const presentCountBySession: Record<string, number> = {}
  for (const p of validPresencas) {
    if (p.presente === '1') presentCountBySession[p.sessao_id] = (presentCountBySession[p.sessao_id] ?? 0) + 1
  }

  const rowsPerTable = {
    parlamentares: source.parlamentares.length,
    proposicoes: source.proposicoes.length,
    sessoes: source.sessoes.length,
    presencas: source.presencas.length,
    votacoes: source.votacoes.length,
    votos: source.votos.length,
  }
  const rowsTotal = Object.values(rowsPerTable).reduce((a, b) => a + b, 0)

  return {
    source,
    rowsTotal,
    rowsPerTable,
    orphanPresencas,
    duplicatePresencas,
    validPresencas,
    orphanVotacoes,
    validVotacoes,
    orphanVotos,
    nullVotos,
    votesOfRejectedVotacoes,
    importableVotos,
    invertedSessoes,
    validSessoes,
    validProposicoes,
    validParlamentares: source.parlamentares,
    unknownDomain,
    presentCountBySession,
    expected: {
      parlamentares: source.parlamentares.length,
      proposicoes: validProposicoes.length,
      sessoes: validSessoes.length,
      presencas: validPresencas.length,
      votacoes: validVotacoes.length,
      votos: importableVotos.length,
      mandatos: source.parlamentares.length,
      pauta: validSessoes.length + validVotacoes.length,
      legislaturas: 1,
    },
  }
}

// ─── Utilitários ────────────────────────────────────────────────────────────

type StatsBag = Record<string, unknown>

function parseStats(run: MigrationRun): StatsBag {
  try {
    return JSON.parse(run.stats) as StatsBag
  } catch {
    return {}
  }
}

function requireStage(run: MigrationRun, stage: MigrationStage): void {
  const prev = PREVIOUS_STAGE[stage]
  if (!prev) return
  const stats = parseStats(run)
  if (!(prev in stats)) {
    throw new DomainError(
      'MIGRATION_INVALID_STAGE',
      409,
      'Estágio fora de ordem',
      `Para executar "${stage}" é necessário concluir antes o estágio "${prev}" nesta execução. Estágios concluídos: ${Object.keys(stats).join(', ') || 'nenhum'}.`
    )
  }
}

async function replaceStageIssues(tx: Tx, runId: string, stage: MigrationStage, issues: Array<{ severity: string; sourceRef?: string; message: string }>) {
  await tx.migrationIssue.deleteMany({ where: { runId, message: { startsWith: `[${stage}] ` } } })
  for (const issue of issues) {
    await tx.migrationIssue.create({
      data: {
        runId,
        severity: issue.severity,
        sourceRef: issue.sourceRef ?? null,
        message: `[${stage}] ${issue.message}`,
      },
    })
  }
}

async function auditStage(tx: Tx, run: MigrationRun, actor: ResolvedActor, stage: MigrationStage, summary: string, correlationId: string, extra?: { action?: string; justification?: string | null }) {
  await writeAudit(tx, {
    tenantId: run.tenantId,
    actor,
    action: extra?.action ?? 'migration.stage_completed',
    aggregateType: 'migration',
    aggregateId: run.id,
    summary: `[${stage}] ${summary}`,
    justification: extra?.justification ?? null,
    correlationId,
  })
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ─── Estágios ───────────────────────────────────────────────────────────────

export type ExecuteStageInput = {
  actor: ResolvedActor
  tenantId: string
  stage: MigrationStage
  runId?: string | null
  justification?: string | null
  correlationId: string
}

/** Ponto único de execução do pipeline — rota POST /api/v1/migration/run. */
export async function executeStage(input: ExecuteStageInput): Promise<MigrationRun> {
  const { actor, tenantId, stage, correlationId } = input

  if (stage === 'inspect') {
    if (input.runId) {
      throw new DomainError(
        'MIGRATION_INVALID_STAGE',
        409,
        'Execução já iniciada',
        'O estágio inspect CRIA uma nova execução — não informe runId. Para retomar, execute os estágios seguintes com o runId retornado.'
      )
    }
    return runInspect(tenantId, actor, correlationId)
  }

  if (!input.runId) {
    throw new DomainError(
      'MIGRATION_INVALID_STAGE',
      409,
      'runId obrigatório',
      `O estágio "${stage}" exige o runId da execução iniciada por inspect.`
    )
  }

  const run = await db.migrationRun.findUnique({ where: { id: input.runId } })
  if (!run) throw new DomainError('NOT_FOUND', 404, 'Não encontrado', `Execução de migração "${input.runId}" não encontrada.`)
  if (run.tenantId !== tenantId) {
    throw new DomainError('FORBIDDEN_TENANT', 403, 'Acesso negado para o tenant', 'A execução de migração pertence a outro tenant.')
  }
  if (run.homologated) {
    throw new DomainError(
      'MIGRATION_HOMOLOGATED',
      409,
      'Execução homologada',
      'Esta execução foi HOMOLOGADA e é imutável: rollback está definitivamente bloqueado e novos estágios não podem ser executados.'
    )
  }
  requireStage(run, stage)

  const analysis = analyzeSource(await readLegacySource())

  switch (stage) {
    case 'validate':
      return runValidate(run, actor, analysis, correlationId)
    case 'plan':
      return runPlan(run, actor, analysis, correlationId)
    case 'dry_run':
      return runDryRun(run, actor, analysis, correlationId)
    case 'import':
      return runImport(run, actor, analysis, correlationId)
    case 'reconcile':
      return runReconcile(run, actor, analysis, correlationId)
    case 'report':
      return runReport(run, actor, analysis, correlationId)
    case 'rollback':
      return runRollback(run, actor, input.justification ?? null, correlationId)
    default:
      throw new DomainError('MIGRATION_INVALID_STAGE', 422, 'Estágio inválido', `Estágio "${stage}" desconhecido.`)
  }
}

// ── inspect ────────────────────────────────────────────────────────────────

async function runInspect(tenantId: string, actor: ResolvedActor, correlationId: string): Promise<MigrationRun> {
  const source = await readLegacySource()
  const analysis = analyzeSource(source)

  return withTransaction(async (tx) => {
    const run = await tx.migrationRun.create({
      data: { tenantId, stage: 'inspect', status: 'running' },
    })

    const issues: Array<{ severity: string; sourceRef?: string; message: string }> = [
      {
        severity: 'info',
        sourceRef: 'manifest.json',
        message: `Fonte legada identificada: ${source.manifest.system} ${source.manifest.version} (HSQLDB), export de ${new Date(source.manifest.generatedAt).toLocaleString('pt-BR')} — ${source.manifest.tables.length} tabelas, ${analysis.rowsTotal} linhas.`,
      },
      {
        severity: 'info',
        sourceRef: '*.csv',
        message: `CSVs lidos em UTF-8 (sem BOM), 100% das linhas parseadas: ${Object.entries(analysis.rowsPerTable)
          .map(([t, n]) => `${t}=${n}`)
          .join(', ')}.`,
      },
      {
        severity: 'info',
        sourceRef: 'manifest.json',
        message: 'Pacote SINTÉTICO (dados fictícios 2021-2024) para demonstração do importador — nenhum dado real de câmara.',
      },
    ]

    const stats = parseStats(run)
    stats.inspect = {
      system: source.manifest.system,
      version: source.manifest.version,
      generatedAt: source.manifest.generatedAt,
      tables: source.manifest.tables.length,
      rowsTotal: analysis.rowsTotal,
      rowsPerTable: analysis.rowsPerTable,
    }

    await replaceStageIssues(tx, run.id, 'inspect', issues)
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'inspect', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(tx, updated, actor, 'inspect', `Inspecionou a fonte legada: ${analysis.rowsTotal} linhas em ${source.manifest.tables.length} tabelas do ${source.manifest.system} ${source.manifest.version}.`, correlationId)
    return updated
  })
}

// ── validate ───────────────────────────────────────────────────────────────

async function runValidate(run: MigrationRun, actor: ResolvedActor, analysis: SourceAnalysis, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    const issues: Array<{ severity: string; sourceRef?: string; message: string }> = []

    for (const { p, reason } of analysis.orphanPresencas) {
      issues.push({ severity: 'error', sourceRef: `presencas.csv:${p.id}`, message: `Presença órfã (${reason}) — registro rejeitado, não será importado.` })
    }
    for (const { v, reason } of analysis.orphanVotacoes) {
      issues.push({ severity: 'error', sourceRef: `votacoes.csv:${v.id}`, message: `Votação órfã (${reason}) — registro rejeitado, não será importado.` })
    }
    for (const { v, reason } of analysis.orphanVotos) {
      issues.push({ severity: 'error', sourceRef: `votos.csv:${v.id}`, message: `Voto órfão (${reason}) — registro rejeitado, não será importado.` })
    }
    for (const d of analysis.unknownDomain) {
      issues.push({ severity: 'error', sourceRef: `${d.table}.csv:${d.id}`, message: `Valor de domínio legado desconhecido em "${d.field}": "${d.value}" — registro rejeitado.` })
    }
    for (const d of analysis.duplicatePresencas) {
      issues.push({ severity: 'warn', sourceRef: `presencas.csv:${d.id}`, message: `Duplicidade de pk no export (linha repetida para ${d.sessao_id}/${d.parlamentar_id}) — dedupe por mapping na importação.` })
    }
    for (const n of analysis.nullVotos) {
      issues.push({ severity: 'warn', sourceRef: `votos.csv:${n.id}`, message: `Voto ausente legado ("NULL") na votação ${n.votacao_id} — NUNCA deduzido; fica pendente de homologação manual.` })
    }
    for (const s of analysis.invertedSessoes) {
      issues.push({ severity: 'warn', sourceRef: `sessoes.csv:${s}`, message: 'Data de encerramento ANTERIOR à abertura (erro típico de export) — será normalizada (datas invertidas) na importação.' })
    }
    if (analysis.votesOfRejectedVotacoes.length > 0) {
      issues.push({
        severity: 'warn',
        sourceRef: `votos.csv:${analysis.votesOfRejectedVotacoes[0]!.votacao_id}`,
        message: `${analysis.votesOfRejectedVotacoes.length} voto(s) pertencem à votação rejeitada ${analysis.votesOfRejectedVotacoes[0]!.votacao_id} (proposição órfã) — não serão importados.`,
      })
    }

    const rejected =
      analysis.orphanPresencas.length +
      analysis.orphanVotacoes.length +
      analysis.orphanVotos.length +
      analysis.unknownDomain.length +
      analysis.duplicatePresencas.length +
      analysis.nullVotos.length +
      analysis.votesOfRejectedVotacoes.length
    const stats = parseStats(run)
    stats.validate = {
      validados: analysis.rowsTotal - rejected,
      rejeitados: rejected,
      avisos: issues.filter((i) => i.severity === 'warn').length,
      erros: issues.filter((i) => i.severity === 'error').length,
    }

    await replaceStageIssues(tx, run.id, 'validate', issues)
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'validate', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(tx, updated, actor, 'validate', `Validou a fonte: ${stats.validate && typeof stats.validate === 'object' ? `${(stats.validate as Record<string, number>).validados} linhas válidas, ${(stats.validate as Record<string, number>).rejeitados} rejeitadas` : ''}.`, correlationId)
    return updated
  })
}

// ── plan ───────────────────────────────────────────────────────────────────

async function runPlan(run: MigrationRun, actor: ResolvedActor, analysis: SourceAnalysis, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    const issues: Array<{ severity: string; sourceRef?: string; message: string }> = [
      {
        severity: 'info',
        message: `Regras de situação: ${Object.entries(MATERIA_STATUS_MAP).map(([k, v]) => `${k}→${v}`).join('; ')}.`,
      },
      {
        severity: 'info',
        message: `Regras de tipo de matéria: ${Object.entries(MATERIA_TYPE_MAP).map(([k, v]) => `${k}→${v}`).join('; ')}.`,
      },
      {
        severity: 'info',
        message: `Regras de sessão/votação: tipo ${Object.entries(SESSAO_TYPE_MAP).map(([k, v]) => `${k}→${v}`).join('; ')} · modo ${Object.entries(VOTACAO_MODE_MAP).map(([k, v]) => `${k}→${v}`).join('; ')} · resultado ${Object.entries(RESULTADO_MAP).map(([k, v]) => `${k}→${v}`).join('; ')}.`,
      },
      {
        severity: 'info',
        message: `Regras de cargo da mesa: ${Object.entries(CARGO_MESA_MAP).map(([k, v]) => `${k}→${v}`).join('; ')} — parlamentares do legado entram INATIVOS com mandato na legislatura 2021-2024 (criada se não existir).`,
      },
      {
        severity: 'info',
        message: 'ID legado jamais vira PK nova: todo registro criado ganha MigrationMapping (sourceTable+sourceId → targetModel+targetId) com as transformações registradas.',
      },
    ]

    // Conflitos de nome (planejado — sem gravar)
    const existing = await tx.parliamentarian.findMany({
      where: { tenantId: run.tenantId, name: { in: analysis.source.parlamentares.map((p) => p.nome) } },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((e) => e.name))
    for (const p of analysis.source.parlamentares) {
      if (existingNames.has(p.nome)) {
        issues.push({
          severity: 'warn',
          sourceRef: `parlamentares.csv:${p.id}`,
          message: `"${p.nome}" coincide com cadastro ATUAL do tenant — plano: importar como registro distinto INATIVO com mandato da legislatura 2021-2024 (sem dedupe automático; decisão registrada para homologação).`,
        })
      }
    }

    const totalMappings =
      analysis.expected.parlamentares +
      analysis.expected.mandatos +
      analysis.expected.proposicoes +
      analysis.expected.sessoes +
      analysis.expected.pauta +
      analysis.expected.presencas +
      analysis.expected.votacoes +
      analysis.expected.votos +
      analysis.expected.legislaturas

    const stats = parseStats(run)
    stats.plan = {
      mapeamentosPrevistos: totalMappings,
      porTabela: analysis.expected,
      conflitosDeNome: [...existingNames].length,
    }

    await replaceStageIssues(tx, run.id, 'plan', issues)
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'plan', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(tx, updated, actor, 'plan', `Montou o plano de mapeamento: ${totalMappings} mapeamentos previstos, ${existing.length} conflito(s) de nome sinalizado(s).`, correlationId)
    return updated
  })
}

// ── dry_run ────────────────────────────────────────────────────────────────

async function runDryRun(run: MigrationRun, actor: ResolvedActor, analysis: SourceAnalysis, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    const issues: Array<{ severity: string; sourceRef?: string; message: string }> = []

    const existing = await tx.parliamentarian.findMany({
      where: { tenantId: run.tenantId, name: { in: analysis.source.parlamentares.map((p) => p.nome) } },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((e) => e.name))
    for (const p of analysis.source.parlamentares) {
      if (existingNames.has(p.nome)) {
        issues.push({
          severity: 'warn',
          sourceRef: `parlamentares.csv:${p.id}`,
          message: `"${p.nome}": nome coincidente com cadastro atual — importar como mandato anterior (registro INATIVO, legislatura 2021-2024); NÃO deduzir/duplicar vínculo.`,
        })
      }
    }
    for (const s of analysis.invertedSessoes) {
      issues.push({ severity: 'warn', sourceRef: `sessoes.csv:${s}`, message: 'Sessão com datas invertidas seria normalizada (abertura/encerramento trocados) — transformação registrada no mapping.' })
    }
    if (analysis.nullVotos.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.nullVotos.length} voto ausente ("NULL") continuaria ausente — nada é deduzido; requer homologação manual.` })
    }

    const stats = parseStats(run)
    stats.dry_run = {
      seriaCriado: {
        legislaturas: analysis.expected.legislaturas,
        parlamentares: analysis.expected.parlamentares,
        mandatos: analysis.expected.mandatos,
        materias: analysis.expected.proposicoes,
        sessoes: analysis.expected.sessoes,
        itensPauta: analysis.expected.pauta,
        presencas: analysis.expected.presencas,
        votacoes: analysis.expected.votacoes,
        votos: analysis.expected.votos,
      },
      naoImportados: {
        presencas: analysis.orphanPresencas.length + analysis.duplicatePresencas.length,
        votacoes: analysis.orphanVotacoes.length,
        votos: analysis.orphanVotos.length + analysis.nullVotos.length + analysis.votesOfRejectedVotacoes.length,
      },
      conflitos: existing.length,
    }

    await replaceStageIssues(tx, run.id, 'dry_run', issues)
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'dry_run', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(tx, updated, actor, 'dry_run', `Simulou a importação em memória: ${analysis.expected.parlamentares} parlamentares, ${analysis.expected.sessoes} sessões, ${analysis.expected.votos} votos seriam criados; ${existing.length} conflito(s) de nome.`, correlationId)
    return updated
  })
}

// ── import ─────────────────────────────────────────────────────────────────

type MappingIndex = Map<string, { targetId: string; targetModel: string }>

async function runImport(run: MigrationRun, actor: ResolvedActor, analysis: SourceAnalysis, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    const tenantId = run.tenantId
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new DomainError('NOT_FOUND', 404, 'Não encontrado', 'Tenant da execução não encontrado.')
    let quorumMinimum = 7
    try {
      const settings = JSON.parse(tenant.settings) as { quorumMinimum?: number }
      if (typeof settings.quorumMinimum === 'number') quorumMinimum = settings.quorumMinimum
    } catch {
      // default
    }

    // Índice de mappings (idempotência: re-executar pula mappings existentes)
    const existingMappings = await tx.migrationMapping.findMany({ where: { runId: run.id } })
    const mapped: MappingIndex = new Map(existingMappings.map((m) => [`${m.sourceTable}:${m.sourceId}`, { targetId: m.targetId, targetModel: m.targetModel }]))
    let mappingsNovos = 0
    const createdCounts = { legislaturas: 0, parlamentares: 0, mandatos: 0, materias: 0, sessoes: 0, itensPauta: 0, presencas: 0, votacoes: 0, votos: 0 }
    const issues: Array<{ severity: string; sourceRef?: string; message: string }> = []

    // Proteção contra dupla importação: registros já mapeados por OUTRA
    // execução do tenant são ignorados (conflito explícito, nunca silencioso).
    const otherRunMappings = await tx.migrationMapping.findMany({
      where: { run: { tenantId }, NOT: { runId: run.id } },
      select: { sourceTable: true, sourceId: true, runId: true },
    })
    const otherRunKeys = new Map(otherRunMappings.map((m) => [`${m.sourceTable}:${m.sourceId}`, m.runId]))
    let jaImportadosOutraRun = 0
    const guardOtherRun = (table: string, id: string): string | null => {
      const otherRun = otherRunKeys.get(`${table}:${id}`)
      if (otherRun) jaImportadosOutraRun++
      return otherRun ?? null
    }

    const putMapping = async (sourceTable: string, sourceId: string, targetModel: string, targetId: string, transformed: string[]) => {
      const created = await tx.migrationMapping.create({
        data: { runId: run.id, sourceTable, sourceId, targetModel, targetId, transformed: JSON.stringify(transformed) },
      })
      mapped.set(`${sourceTable}:${sourceId}`, { targetId: created.targetId, targetModel: created.targetModel })
      mappingsNovos++
    }

    // 1) Legislatura 2021-2024 (se não existir). Só ganha mapping quando
    // CRIADA por esta execução — rollback nunca remove registro de outro run.
    let legislature = await tx.legislature.findFirst({ where: { tenantId, number: 17 } })
    if (!mapped.has('legislatura:17')) {
      if (!legislature && !otherRunKeys.has('legislatura:17')) {
        legislature = await tx.legislature.create({
          data: { tenantId, number: 17, startYear: 2021, endYear: 2024, current: false },
        })
        createdCounts.legislaturas++
        await putMapping('legislatura', '17', 'Legislature', legislature.id, ['derivada do intervalo das sessões legadas (2021-2024)'])
      } else if (legislature && otherRunKeys.has('legislatura:17')) {
        issues.push({ severity: 'warn', sourceRef: 'legislatura:17', message: `Legislatura 17 (2021-2024) já importada pela execução ${(otherRunKeys.get('legislatura:17') ?? '').slice(0, 8)}… — reutilizada sem novo mapping.` })
      }
    }
    const legId = mapped.get('legislatura:17')?.targetId ?? legislature?.id
    if (!legId) {
      throw new DomainError('INTERNAL_ERROR', 500, 'Erro interno', 'Legislatura 2021-2024 não pôde ser resolvida para a importação.')
    }

    // 2) Parlamentares (INATIVOS) + mandatos
    const legacyNames = analysis.source.parlamentares.map((p) => p.nome)
    const collisions = await tx.parliamentarian.findMany({ where: { tenantId, name: { in: legacyNames } }, select: { name: true } })
    const collisionNames = new Set(collisions.map((c) => c.name))
    let order = 1000
    for (const p of analysis.validParlamentares) {
      if (mapped.has(`parlamentares:${p.id}`)) continue
      const otherRun = guardOtherRun('parlamentares', p.id)
      if (otherRun) {
        issues.push({ severity: 'warn', sourceRef: `parlamentares.csv:${p.id}`, message: `Parlamentar ${p.id} (${p.nome}) já importado pela execução ${otherRun.slice(0, 8)}… — ignorado (faça o rollback daquela execução antes de reimportar).` })
        continue
      }
      const boardRole = CARGO_MESA_MAP[p.cargo_mesa] ?? 'vereador'
      const transformed = [`ativo=${p.ativo} → importado INATIVO (mandato anterior)`, `cargo_mesa=${p.cargo_mesa} → boardRole=${boardRole}`]
      if (collisionNames.has(p.nome)) transformed.push('nome coincidente com cadastro atual — importado como registro distinto inativo')
      const parl = await tx.parliamentarian.create({
        data: { tenantId, name: p.nome, party: p.partido, boardRole, active: false, order: order++ },
      })
      createdCounts.parlamentares++
      await putMapping('parlamentares', p.id, 'Parliamentarian', parl.id, transformed)
      const mandate = await tx.mandate.create({
        data: { tenantId, parliamentarianId: parl.id, legislatureId: legId, startDate: new Date(2021, 0, 1), endDate: new Date(2024, 11, 31) },
      })
      createdCounts.mandatos++
      await putMapping('mandatos', p.id, 'Mandate', mandate.id, [`mandato da legislatura 17 (2021-2024) criado pelo importador`])
      if (collisionNames.has(p.nome)) {
        issues.push({
          severity: 'info',
          sourceRef: `parlamentares.csv:${p.id}`,
          message: `"${p.nome}" importado como registro distinto INATIVO (mandato 2021-2024) — nome coincide com cadastro atual; decisão registrada para homologação.`,
        })
      }
    }

    // 3) Matérias (proposições)
    for (const pr of analysis.validProposicoes) {
      if (mapped.has(`proposicoes:${pr.id}`)) continue
      const otherRun = guardOtherRun('proposicoes', pr.id)
      if (otherRun) {
        issues.push({ severity: 'warn', sourceRef: `proposicoes.csv:${pr.id}`, message: `Proposição ${pr.id} já importada pela execução ${otherRun.slice(0, 8)}… — ignorada (conflito de chave natural evitado).` })
        continue
      }
      const type = MATERIA_TYPE_MAP[pr.tipo]!
      const status = MATERIA_STATUS_MAP[pr.situacao_legado]!
      const authors = pr.autores.split('|').map((a) => a.trim()).filter(Boolean)
      const matter = await tx.legislativeMatter.create({
        data: {
          tenantId,
          type,
          number: Number(pr.numero),
          year: Number(pr.ano),
          ementa: pr.ementa,
          authors: JSON.stringify(authors),
          status,
          regime: 'ordinario',
        },
      })
      createdCounts.materias++
      await putMapping('proposicoes', pr.id, 'LegislativeMatter', matter.id, [
        `tipo=${pr.tipo} → ${type}`,
        `situacao_legado=${pr.situacao_legado} → ${status}`,
        `ano ${pr.ano} preservado`,
        `autores pipe-separated → JSON (${authors.length})`,
      ])
    }

    // 4) Sessões (closed, com expediente na pauta)
    const presidente = analysis.source.parlamentares.find((p) => p.cargo_mesa === 'PRESIDENTE')
    const secretario = analysis.source.parlamentares.find((p) => p.cargo_mesa === 'PRIMEIRO_SECRETARIO')
    const sessionMeta = new Map<string, { id: string; openedAt: Date; closedAt: Date }>()
    for (const { s, inverted } of analysis.validSessoes) {
      if (mapped.has(`sessoes:${s.id}`)) {
        const m = mapped.get(`sessoes:${s.id}`)!
        const row = await tx.session.findUnique({ where: { id: m.targetId } })
        if (row) sessionMeta.set(s.id, { id: row.id, openedAt: row.openedAt ?? row.scheduledAt, closedAt: row.closedAt ?? row.scheduledAt })
        continue
      }
      const otherRun = guardOtherRun('sessoes', s.id)
      if (otherRun) {
        issues.push({ severity: 'warn', sourceRef: `sessoes.csv:${s.id}`, message: `Sessão ${s.id} (nº ${s.numero}/${s.ano}) já importada pela execução ${otherRun.slice(0, 8)}… — ignorada (conflito de chave natural evitado).` })
        continue
      }
      let abertura = parseLegacyDate(s.data_abertura)!
      let encerramento = parseLegacyDate(s.data_encerramento)!
      if (inverted) {
        const swap = abertura
        abertura = encerramento
        encerramento = swap
      }
      const type = SESSAO_TYPE_MAP[s.tipo_legado] ?? 'ordinaria'
      const session = await tx.session.create({
        data: {
          tenantId,
          number: Number(s.numero),
          year: Number(s.ano),
          type,
          scheduledAt: abertura,
          openedAt: abertura,
          closedAt: encerramento,
          status: 'closed',
          presidentName: presidente?.nome ?? null,
          secretaryName: secretario?.nome ?? null,
          location: 'Plenário (legado)',
          agendaPublished: true,
          notes: `Importado do PainelDeskLegis 8.1 — execução ${run.id}`,
          version: 1,
        },
      })
      createdCounts.sessoes++
      await putMapping('sessoes', s.id, 'Session', session.id, [
        `tipo_legado=${s.tipo_legado} → ${type}`,
        `status_legado=${s.status_legado} → closed`,
        ...(inverted ? ['datas de abertura/encerramento invertidas no export — normalizadas'] : []),
      ])
      sessionMeta.set(s.id, { id: session.id, openedAt: abertura, closedAt: encerramento })

      const item = await tx.agendaItem.create({
        data: {
          sessionId: session.id,
          order: 0,
          section: 'expediente',
          title: 'Abertura dos trabalhos e verificação de quórum (sessão legada importada).',
          kind: 'individual',
          status: 'aprovado',
        },
      })
      createdCounts.itensPauta++
      await putMapping('pauta', `${s.id}:expediente`, 'AgendaItem', item.id, ['item de expediente sintético da sessão legada'])
    }

    // 5) Presenças
    for (const p of analysis.validPresencas) {
      if (mapped.has(`presencas:${p.id}`)) continue
      const otherRun = guardOtherRun('presencas', p.id)
      if (otherRun) continue // presença já importada por outra execução (resumo abaixo)
      const sessao = mapped.get(`sessoes:${p.sessao_id}`)
      const parl = mapped.get(`parlamentares:${p.parlamentar_id}`)
      if (!sessao || !parl) {
        issues.push({ severity: 'warn', sourceRef: `presencas.csv:${p.id}`, message: `Presença ${p.id} não importada (sessão/parlamentar não mapeados).` })
        continue
      }
      const meta = sessionMeta.get(p.sessao_id)
      const presente = p.presente === '1'
      const evt = await tx.attendanceEvent.create({
        data: {
          sessionId: sessao.targetId,
          parliamentarianId: parl.targetId,
          kind: presente ? 'check_in' : 'mark',
          status: presente ? 'presente' : 'ausente',
          source: 'operador',
          note: 'Importado do PainelDeskLegis 8.1',
          createdAt: meta?.openedAt ?? new Date(),
        },
      })
      createdCounts.presencas++
      await putMapping('presencas', p.id, 'AttendanceEvent', evt.id, [`presente=${p.presente} → ${presente ? 'check_in/presente' : 'mark/ausente'}`])
    }

    // 6) Votações (+ itens de pauta da ordem do dia) + votos
    const votingIdxBySession = new Map<string, number>()
    for (const v of analysis.validVotacoes) {
      if (mapped.has(`votacoes:${v.id}`)) continue
      const otherRun = guardOtherRun('votacoes', v.id)
      if (otherRun) {
        issues.push({ severity: 'warn', sourceRef: `votacoes.csv:${v.id}`, message: `Votação ${v.id} já importada pela execução ${otherRun.slice(0, 8)}… — ignorada (conflito de chave natural evitado).` })
        continue
      }
      const sessao = mapped.get(`sessoes:${v.sessao_id}`)
      const matterMap = mapped.get(`proposicoes:${v.proposicao_id}`)
      if (!sessao || !matterMap) {
        issues.push({ severity: 'warn', sourceRef: `votacoes.csv:${v.id}`, message: `Votação ${v.id} não importada (sessão/proposição não mapeadas).` })
        continue
      }
      const meta = sessionMeta.get(v.sessao_id)!
      const prop = analysis.source.proposicoes.find((pr) => pr.id === v.proposicao_id)!
      const mode = VOTACAO_MODE_MAP[v.modo_legado]!
      const resultStatus = RESULTADO_MAP[v.resultado_legado] ?? null
      const type = MATERIA_TYPE_MAP[prop.tipo]!
      const typeLabel = type === 'projeto_de_lei' ? 'PL' : type === 'requerimento' ? 'REQ' : type === 'indicacao' ? 'IND' : type === 'mocao' ? 'MO' : 'DEC'
      const openedAt = new Date(meta.openedAt.getTime() + 30 * 60 * 1000)
      const closedAt = new Date(Math.min(meta.openedAt.getTime() + 35 * 60 * 1000, meta.closedAt.getTime()))
      const presentCount = analysis.presentCountBySession[v.sessao_id] ?? 0
      const idx = (votingIdxBySession.get(v.sessao_id) ?? 0) + 1
      votingIdxBySession.set(v.sessao_id, idx)

      const agendaTitle = `${typeLabel} ${prop.numero}/${prop.ano} — ${prop.ementa.length > 110 ? prop.ementa.slice(0, 107) + '…' : prop.ementa}`
      const agendaItem = await tx.agendaItem.create({
        data: {
          sessionId: sessao.targetId,
          order: idx,
          section: 'ordem_do_dia',
          matterId: matterMap.targetId,
          matterType: type,
          matterNumber: `${prop.numero}/${prop.ano}`,
          matterYear: Number(prop.ano),
          title: agendaTitle,
          kind: 'individual',
          status: resultStatus === 'rejeitado' ? 'rejeitado' : resultStatus === 'aprovado' ? 'aprovado' : 'pendente',
          resultSummary: `${resultStatus === 'aprovado' ? 'Aprovado' : resultStatus === 'rejeitado' ? 'Rejeitado' : 'Resultado não mapeado'} — votação ${mode === 'nominal' ? 'nominal' : mode === 'simbolico' ? 'simbólica' : 'secreta'} importada do legado.`,
        },
      })
      createdCounts.itensPauta++
      await putMapping('pauta', `${v.sessao_id}:${v.proposicao_id}`, 'AgendaItem', agendaItem.id, ['item da ordem do dia derivado da votação legada'])

      const votingVotes = analysis.importableVotos.filter((vv) => vv.votacao_id === v.id)
      const counts = { sim: 0, nao: 0, abstencoes: 0, naoRegistraram: Math.max(0, presentCount - votingVotes.length), presentes: presentCount }
      for (const vv of votingVotes) counts[VOTO_MAP[vv.voto] as 'sim' | 'nao' | 'abstencoes']++
      const resultDetail =
        mode === 'nominal'
          ? JSON.stringify(
              votingVotes.map((vv, i) => {
                const parl = analysis.source.parlamentares.find((pp) => pp.id === vv.parlamentar_id)
                return {
                  parliamentarianId: mapped.get(`parlamentares:${vv.parlamentar_id}`)!.targetId,
                  name: parl?.nome ?? vv.parlamentar_id,
                  value: VOTO_MAP[vv.voto],
                  order: i,
                }
              })
            )
          : null

      const voting = await tx.voting.create({
        data: {
          sessionId: sessao.targetId,
          agendaItemId: agendaItem.id,
          matterId: matterMap.targetId,
          question: `${typeLabel} nº ${prop.numero}/${prop.ano} — ${prop.ementa.length > 90 ? prop.ementa.slice(0, 87) + '…' : prop.ementa}`,
          mode,
          status: 'closed',
          rule: 'maioria_simples',
          openedAt,
          closedAt,
          presentAtOpen: presentCount,
          quorumAtOpen: quorumMinimum,
          presentAtClose: presentCount,
          quorumAtClose: quorumMinimum,
          hidePartial: false,
          resultStatus,
          resultCounts: JSON.stringify(counts),
          resultDetail,
          justification: null,
          version: 1,
        },
      })
      createdCounts.votacoes++
      await putMapping('votacoes', v.id, 'Voting', voting.id, [
        `modo_legado=${v.modo_legado} → ${mode}`,
        `resultado_legado=${v.resultado_legado} → ${resultStatus}`,
        'snapshots de quórum/presentes derivados das presenças legadas da sessão',
      ])

      for (const vv of votingVotes) {
        if (mapped.has(`votos:${vv.id}`)) continue
        const otherRun = guardOtherRun('votos', vv.id)
        if (otherRun) continue // voto já importado por outra execução
        const parl = mapped.get(`parlamentares:${vv.parlamentar_id}`)
        if (!parl) continue
        const vote = await tx.vote.create({
          data: {
            votingId: voting.id,
            parliamentarianId: parl.targetId,
            value: VOTO_MAP[vv.voto]!,
            commandId: `legacy-${vv.id}`,
            receivedAt: closedAt,
          },
        })
        createdCounts.votos++
        await putMapping('votos', vv.id, 'Vote', vote.id, [`voto=${vv.voto} → ${VOTO_MAP[vv.voto]}`, `commandId=legacy-${vv.id} (idempotência do legado)`])
      }
    }

    // Issues de ignorados (resumo)
    if (analysis.orphanPresencas.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.orphanPresencas.length} presença(s) órfã(s) ignorada(s): ${analysis.orphanPresencas.map((o) => o.p.id).join(', ')}.` })
    }
    if (analysis.duplicatePresencas.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.duplicatePresencas.length} presença duplicada ignorada (dedupe por mapping): ${analysis.duplicatePresencas.map((d) => d.id).join(', ')}.` })
    }
    if (analysis.orphanVotacoes.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.orphanVotacoes.length} votação(ões) órfã(s) ignorada(s): ${analysis.orphanVotacoes.map((o) => o.v.id).join(', ')}.` })
    }
    if (analysis.nullVotos.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.nullVotos.length} voto(s) "NULL" não importado(s) (nunca deduzidos): ${analysis.nullVotos.map((n) => n.id).join(', ')}.` })
    }
    if (analysis.orphanVotos.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.orphanVotos.length} voto(s) órfão(s) ignorado(s): ${analysis.orphanVotos.map((o) => o.v.id).join(', ')}.` })
    }
    if (analysis.votesOfRejectedVotacoes.length > 0) {
      issues.push({ severity: 'warn', message: `${analysis.votesOfRejectedVotacoes.length} voto(s) de votação rejeitada não importado(s).` })
    }
    if (jaImportadosOutraRun > 0) {
      issues.push({ severity: 'warn', message: `${jaImportadosOutraRun} registro(s) do export já haviam sido importados por OUTRA execução deste tenant e foram ignorados (proteção contra dupla importação).` })
    }

    const stats = parseStats(run)
    stats.import = {
      criados: createdCounts,
      mappingsNovos,
      mappingsExistentes: existingMappings.length,
      jaImportadosOutraRun,
      ignorados: {
        presencas: analysis.orphanPresencas.length + analysis.duplicatePresencas.length,
        votacoes: analysis.orphanVotacoes.length,
        votos: analysis.orphanVotos.length + analysis.nullVotos.length + analysis.votesOfRejectedVotacoes.length,
      },
    }

    await replaceStageIssues(tx, run.id, 'import', issues)
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'import', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(
      tx,
      updated,
      actor,
      'import',
      `Importou o legado: ${createdCounts.parlamentares} parlamentares (inativos, mandato 2021-2024), ${createdCounts.materias} matérias, ${createdCounts.sessoes} sessões, ${createdCounts.presencas} presenças, ${createdCounts.votacoes} votações, ${createdCounts.votos} votos — ${mappingsNovos} novos mappings (idempotente).`,
      correlationId
    )
    return updated
  })
}

// ── reconcile ──────────────────────────────────────────────────────────────

async function targetExists(tx: Tx, targetModel: string, targetId: string): Promise<boolean> {
  switch (targetModel) {
    case 'Legislature':
      return (await tx.legislature.count({ where: { id: targetId } })) > 0
    case 'Parliamentarian':
      return (await tx.parliamentarian.count({ where: { id: targetId } })) > 0
    case 'Mandate':
      return (await tx.mandate.count({ where: { id: targetId } })) > 0
    case 'LegislativeMatter':
      return (await tx.legislativeMatter.count({ where: { id: targetId } })) > 0
    case 'Session':
      return (await tx.session.count({ where: { id: targetId } })) > 0
    case 'AgendaItem':
      return (await tx.agendaItem.count({ where: { id: targetId } })) > 0
    case 'AttendanceEvent':
      return (await tx.attendanceEvent.count({ where: { id: targetId } })) > 0
    case 'Voting':
      return (await tx.voting.count({ where: { id: targetId } })) > 0
    case 'Vote':
      return (await tx.vote.count({ where: { id: targetId } })) > 0
    default:
      return false
  }
}

async function runReconcile(run: MigrationRun, actor: ResolvedActor, analysis: SourceAnalysis, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    const mappings = await tx.migrationMapping.findMany({ where: { runId: run.id } })
    const byTable = new Map<string, number>()
    for (const m of mappings) byTable.set(m.sourceTable, (byTable.get(m.sourceTable) ?? 0) + 1)

    const divergences: string[] = []
    const porTabela: Record<string, { fonte: number; destino: number }> = {}
    for (const table of ['parlamentares', 'mandatos', 'proposicoes', 'sessoes', 'pauta', 'presencas', 'votacoes', 'votos', 'legislatura']) {
      // esperado usa a chave plural 'legislaturas'; mapping usa sourceTable 'legislatura'
      const fonte = analysis.expected[table === 'legislatura' ? 'legislaturas' : table] ?? 0
      const destino = byTable.get(table) ?? 0
      porTabela[table] = { fonte, destino }
      if (fonte !== destino) divergences.push(`${table}: fonte ${fonte} × destino ${destino}`)
    }

    // Alvos existem de fato?
    let missingTargets = 0
    const existingTargetIds: string[] = []
    for (const m of mappings) {
      const exists = await targetExists(tx, m.targetModel, m.targetId)
      if (exists) existingTargetIds.push(m.targetId)
      else missingTargets++
    }
    if (missingTargets > 0) divergences.push(`${missingTargets} mapping(s) apontam para registros inexistentes`)

    // Checksum agregado (sha256 dos ids ordenados)
    const checksumMapeamentos = sha256(mappings.map((m) => m.targetId).sort().join(','))
    const checksumDestino = sha256(existingTargetIds.slice().sort().join(','))

    // Amostras aleatórias (5)
    const shuffled = [...mappings].sort(() => Math.random() - 0.5)
    const sampleMappings = shuffled.slice(0, Math.min(5, shuffled.length))
    const amostras = await Promise.all(
      sampleMappings.map(async (m) => ({
        fonte: `${m.sourceTable}:${m.sourceId}`,
        destino: `${m.targetModel}:${m.targetId.slice(0, 8)}…`,
        ok: await targetExists(tx, m.targetModel, m.targetId),
      }))
    )

    const issues: Array<{ severity: string; sourceRef?: string; message: string }> = []
    if (divergences.length > 0) {
      for (const d of divergences) issues.push({ severity: 'error', message: `Divergência fonte × destino — ${d}.` })
    } else {
      issues.push({ severity: 'info', message: `Contagens conferem para todas as tabelas (${mappings.length} mappings verificados) e checksum agregado idêntico (sha256 ${checksumMapeamentos.slice(0, 12)}…).` })
    }

    const stats = parseStats(run)
    stats.reconcile = {
      divergencias: divergences.length,
      porTabela,
      checksumMapeamentos,
      checksumDestino,
      checksumIguais: checksumMapeamentos === checksumDestino,
      amostras,
    }

    await replaceStageIssues(tx, run.id, 'reconcile', issues)
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'reconcile', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(tx, updated, actor, 'reconcile', `Reconciliou fonte × destino: ${divergences.length} divergência(s) em ${mappings.length} mappings (amostras de ${amostras.length}).`, correlationId)
    return updated
  })
}

// ── report ─────────────────────────────────────────────────────────────────

async function runReport(run: MigrationRun, actor: ResolvedActor, analysis: SourceAnalysis, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    const stats = parseStats(run)
    const [issues, mappings] = await Promise.all([
      tx.migrationIssue.findMany({ where: { runId: run.id } }),
      tx.migrationMapping.findMany({ where: { runId: run.id } }),
    ])
    const bySeverity = { info: 0, warn: 0, error: 0 }
    for (const i of issues) bySeverity[i.severity as keyof typeof bySeverity]++

    const finishedAt = new Date()
    const report = {
      fonte: `${analysis.source.manifest.system} ${analysis.source.manifest.version} (sintético)`,
      run: { id: run.id, startedAt: run.startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
      estagios: Object.fromEntries(
        MIGRATION_STAGES.filter((s) => s in stats).map((s) => [s, stats[s]])
      ),
      totaisImportados: analysis.expected,
      issues: {
        porSeveridade: bySeverity,
        lista: issues.map((i) => ({ severity: i.severity, sourceRef: i.sourceRef, message: i.message })),
      },
      amostras: mappings.slice(0, 5).map((m) => ({ fonte: `${m.sourceTable}:${m.sourceId}`, destino: `${m.targetModel}:${m.targetId.slice(0, 8)}…` })),
      homologacao: {
        pendente: true,
        aviso: 'A homologação é IRREVERSÍVEL e bloqueia definitivamente o rollback desta execução.',
      },
      geradoEm: finishedAt.toISOString(),
    }

    stats.report = {
      issues: bySeverity,
      totalMappings: mappings.length,
      divergencias: (stats.reconcile as Record<string, unknown> | undefined)?.divergencias ?? null,
    }

    await replaceStageIssues(tx, run.id, 'report', [
      { severity: 'info', message: `Relatório final consolidado: ${mappings.length} mappings, ${bySeverity.warn} aviso(s), ${bySeverity.error} erro(s). Homologação pendente (irreversível).` },
    ])
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'report', status: 'completed', stats: JSON.stringify(stats), report: JSON.stringify(report), finishedAt },
    })
    await auditStage(tx, updated, actor, 'report', `Gerou o relatório final da migração: ${mappings.length} mappings, issues ${bySeverity.info}i/${bySeverity.warn}w/${bySeverity.error}e.`, correlationId)
    return updated
  })
}

// ── rollback ───────────────────────────────────────────────────────────────

async function runRollback(run: MigrationRun, actor: ResolvedActor, justification: string | null, correlationId: string): Promise<MigrationRun> {
  return withTransaction(async (tx) => {
    if (run.homologated) {
      throw new DomainError('MIGRATION_HOMOLOGATED', 409, 'Execução homologada', 'Rollback bloqueado: esta execução foi homologada e seus dados são oficiais.')
    }
    const mappings = await tx.migrationMapping.findMany({ where: { runId: run.id } })
    const idsByModel = new Map<string, string[]>()
    for (const m of mappings) {
      const list = idsByModel.get(m.targetModel) ?? []
      list.push(m.targetId)
      idsByModel.set(m.targetModel, list)
    }
    const idsOf = (model: string) => ({ id: { in: idsByModel.get(model) ?? [] } })

    // Ordem INVERSA de dependência: votes → votings → attendance → agenda →
    // sessions → matters → mandates → legislature → parliamentarians
    const removidos = {
      votos: await tx.vote.deleteMany({ where: idsOf('Vote') }),
      votacoes: await tx.voting.deleteMany({ where: idsOf('Voting') }),
      presencas: await tx.attendanceEvent.deleteMany({ where: idsOf('AttendanceEvent') }),
      pauta: await tx.agendaItem.deleteMany({ where: idsOf('AgendaItem') }),
      sessoes: await tx.session.deleteMany({ where: idsOf('Session') }),
      materias: await tx.legislativeMatter.deleteMany({ where: idsOf('LegislativeMatter') }),
      mandatos: await tx.mandate.deleteMany({ where: idsOf('Mandate') }),
      legislaturas: await tx.legislature.deleteMany({ where: idsOf('Legislature') }),
      parlamentares: await tx.parliamentarian.deleteMany({ where: idsOf('Parliamentarian') }),
    }

    await tx.migrationMapping.deleteMany({ where: { runId: run.id } })

    const stats = parseStats(run)
    stats.rollback = {
      removidos: Object.fromEntries(Object.entries(removidos).map(([k, r]) => [k, r.count])),
      mappingsRemovidos: mappings.length,
    }

    await replaceStageIssues(tx, run.id, 'rollback', [
      { severity: 'warn', message: `Rollback executado: ${mappings.length} mappings removidos junto com os dados importados (votos ${removidos.votos.count}, sessões ${removidos.sessoes.count}, matérias ${removidos.materias.count}, parlamentares ${removidos.parlamentares.count}). Execução preservada para auditoria.` },
    ])
    const updated = await tx.migrationRun.update({
      where: { id: run.id },
      data: { stage: 'rollback', status: 'completed', stats: JSON.stringify(stats) },
    })
    await auditStage(
      tx,
      updated,
      actor,
      'rollback',
      `Rollback da migração: removeu ${mappings.length} registros mapeados (votos ${removidos.votos.count}, presenças ${removidos.presencas.count}, sessões ${removidos.sessoes.count}, matérias ${removidos.materias.count}, parlamentares ${removidos.parlamentares.count}).`,
      correlationId,
      { action: 'migration.rollback', justification }
    )
    return updated
  })
}

// ─── Serialização → View ────────────────────────────────────────────────────

export type MigrationRunView = {
  id: string
  tenantId: string
  stage: string
  status: string
  homologated: boolean
  stats: Record<string, unknown>
  report: Record<string, unknown> | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  issueCounts: { info: number; warn: number; error: number }
  mappingCount: number
  issues?: Array<{ id: string; severity: string; sourceRef: string | null; message: string }>
}

export function toMigrationRunView(
  run: MigrationRun,
  extras: { issueCounts: { info: number; warn: number; error: number }; mappingCount: number; issues?: MigrationRunView['issues'] }
): MigrationRunView {
  let stats: Record<string, unknown> = {}
  let report: Record<string, unknown> | null = null
  try {
    stats = JSON.parse(run.stats)
  } catch {
    stats = {}
  }
  if (run.report) {
    try {
      report = JSON.parse(run.report)
    } catch {
      report = null
    }
  }
  return {
    id: run.id,
    tenantId: run.tenantId,
    stage: run.stage,
    status: run.status,
    homologated: run.homologated,
    stats,
    report,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    issueCounts: extras.issueCounts,
    mappingCount: extras.mappingCount,
    issues: extras.issues,
  }
}

/** Contagens de issues por severidade para uma lista de runs (uma query). */
export async function issueCountsByRun(runIds: string[]): Promise<Map<string, { info: number; warn: number; error: number }>> {
  const map = new Map<string, { info: number; warn: number; error: number }>(runIds.map((id) => [id, { info: 0, warn: 0, error: 0 }]))
  if (runIds.length === 0) return map
  const grouped = await db.migrationIssue.groupBy({
    by: ['runId', 'severity'],
    where: { runId: { in: runIds } },
    _count: { _all: true },
  })
  for (const g of grouped) {
    const entry = map.get(g.runId)
    if (!entry) continue
    if (g.severity === 'info' || g.severity === 'warn' || g.severity === 'error') {
      entry[g.severity] += g._count._all
    }
  }
  return map
}

/** Contagem de mappings por run (uma query). */
export async function mappingCountsByRun(runIds: string[]): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map()
  const grouped = await db.migrationMapping.groupBy({ by: ['runId'], where: { runId: { in: runIds } }, _count: { _all: true } })
  return new Map(grouped.map((g) => [g.runId, g._count._all]))
}
