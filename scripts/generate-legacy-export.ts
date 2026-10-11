/**
 * Gerador do pacote de export SINTÉTICO do PainelDeskLegis 8.1 (Fase 8).
 *
 * Produz `upload/legacy/` — export fictício do banco HSQLDB do sistema
 * legado em CSV, com sujeira realista para exercitar o importador:
 *   - parlamentares.csv: 15 vereadores da legislatura 2021-2024 (3 com nomes
 *     idênticos aos atuais do tenant demo → teste de conflito/dedupe);
 *   - proposicoes.csv: 20 proposições com situacao_legado em valores legados;
 *   - sessoes.csv: 6 sessões 2021-2024 (1 com data de encerramento ANTERIOR
 *     à abertura — erro realista de export);
 *   - presencas.csv: 72 linhas — 2 órfãs (parlamentar_id inexistente) e
 *     1 duplicidade (mesma pk);
 *   - votacoes.csv: 8 votações (1 com proposicao_id órfã);
 *   - votos.csv: 60 votos (1 "NULL" legado e 1 órfão de parlamentar).
 *
 * Execução: bun scripts/generate-legacy-export.ts
 * Dados 100% FICTÍCIOS — nenhum dado real de câmara.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(process.cwd(), 'upload', 'legacy')

/** CSV writer com aspas quando necessário (ementas têm vírgulas). */
function toCsv(rows: Array<Record<string, string | number>>): string {
  const headers = Object.keys(rows[0]!)
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h] ?? '')).join(','))]
  return lines.join('\n') + '\n'
}

// ─── Parlamentares (legislatura 2021-2024) ───────────────────────────────────
// P001-P003 têm nomes IGUAIS a parlamentares atuais do tenant demo
// (Roberto Nogueira, Sandra Ribeiro, Carla Mendes) — conflito proposital.
const parlamentares = [
  { id: 'P001', nome: 'Roberto Nogueira', partido: 'PSD', cargo_mesa: 'PRESIDENTE', ativo: 0 },
  { id: 'P002', nome: 'Sandra Ribeiro', partido: 'PSDB', cargo_mesa: 'PRIMEIRO_SECRETARIO', ativo: 0 },
  { id: 'P003', nome: 'Carla Mendes', partido: 'PT', cargo_mesa: 'VEREADOR', ativo: 0 },
  { id: 'P004', nome: 'Benedito Salgado', partido: 'MDB', cargo_mesa: 'VICE_PRESIDENTE', ativo: 0 },
  { id: 'P005', nome: 'Cida Ramalho', partido: 'PDT', cargo_mesa: 'VEREADOR', ativo: 0 },
  { id: 'P006', nome: 'Dorival Pinto', partido: 'PP', cargo_mesa: 'VEREADOR', ativo: 1 },
  { id: 'P007', nome: 'Eva Barbosa', partido: 'REPUBLICAN', cargo_mesa: 'VEREADOR', ativo: 1 },
  { id: 'P008', nome: 'Francisco das Chagas', partido: 'PL', cargo_mesa: 'SEGUNDO_SECRETARIO', ativo: 0 },
  { id: 'P009', nome: 'Gláucia Prado', partido: 'PODEMOS', cargo_mesa: 'VEREADOR', ativo: 1 },
  { id: 'P010', nome: 'Heitor Vasconcelos', partido: 'PSB', cargo_mesa: 'VEREADOR', ativo: 0 },
  { id: 'P011', nome: 'Ivone Peixoto', partido: 'CIDADANIA', cargo_mesa: 'VEREADOR', ativo: 0 },
  { id: 'P012', nome: 'Jorge Takahashi', partido: 'PV', cargo_mesa: 'VEREADOR', ativo: 1 },
  { id: 'P013', nome: 'Lucrécia Fontes', partido: 'SOLIDARIEDADE', cargo_mesa: 'VEREADOR', ativo: 0 },
  { id: 'P014', nome: 'Nelson Bandeira', partido: 'AVANTE', cargo_mesa: 'VEREADOR', ativo: 0 },
  { id: 'P015', nome: 'Olívia Marchetti', partido: 'DEM', cargo_mesa: 'VEREADOR', ativo: 1 },
]

// ─── Proposições (2021-2024, situações legadas) ──────────────────────────────
const proposicoes = [
  { id: 'PR001', tipo: 'PROJETO_LEI', numero: 101, ano: 2021, ementa: 'Institui o Programa Municipal de Primeira Infância e dá outras providências.', autores: 'Roberto Nogueira|Benedito Salgado', situacao_legado: 'APROVADA' },
  { id: 'PR002', tipo: 'REQUERIMENTO', numero: 210, ano: 2021, ementa: 'Requer ao Executivo informações sobre a execução do orçamento da educação no exercício de 2021.', autores: 'Cida Ramalho', situacao_legado: 'APROVADA' },
  { id: 'PR003', tipo: 'PROJETO_LEI', numero: 108, ano: 2021, ementa: 'Altera o Código de Posturas para disciplinar o uso de calçadas pelo comércio.', autores: 'Dorival Pinto', situacao_legado: 'REJEITADA' },
  { id: 'PR004', tipo: 'INDICACAO', numero: 55, ano: 2021, ementa: 'Indica ao Executivo a recuperação da pavimentação da Rua das Hibiscos, no Centro.', autores: 'Eva Barbosa', situacao_legado: 'APROVADA' },
  { id: 'PR005', tipo: 'MOCAO', numero: 12, ano: 2021, ementa: 'Moção de Congratulações aos 50 anos do Corpo de Bombeiros da cidade.', autores: 'Francisco das Chagas|Gláucia Prado', situacao_legado: 'APROVADA' },
  { id: 'PR006', tipo: 'PROJETO_LEI', numero: 115, ano: 2022, ementa: 'Cria o Conselho Municipal de Cultura e estabelece sua composição e competências.', autores: 'Heitor Vasconcelos', situacao_legado: 'APROVADA' },
  { id: 'PR007', tipo: 'DECRETO_LEGISLATIVO', numero: 3, ano: 2022, ementa: 'Concede o Título de Cidadão Vilanovense ao empresário e benemérito Sr. Altair Duarte.', autores: 'Roberto Nogueira', situacao_legado: 'APROVADA' },
  { id: 'PR008', tipo: 'REQUERIMENTO', numero: 245, ano: 2022, ementa: 'Requer realização de sessão solene em homenagem ao Dia do Agricultor.', autores: 'Ivone Peixoto', situacao_legado: 'ARQUIVADA' },
  { id: 'PR009', tipo: 'PROJETO_LEI', numero: 121, ano: 2022, ementa: 'Dispõe sobre a criação do Fundo Municipal de Assistência Social.', autores: 'Jorge Takahashi|Lucrécia Fontes', situacao_legado: 'EM_TRAMITACAO' },
  { id: 'PR010', tipo: 'INDICACAO', numero: 70, ano: 2022, ementa: 'Indica a instalação de semáforo no cruzamento das Avenidas Central e das Nações.', autores: 'Nelson Bandeira', situacao_legado: 'PAUTA' },
  { id: 'PR011', tipo: 'PROJETO_LEI', numero: 130, ano: 2023, ementa: 'Estabelece o Calendário Oficial de Eventos do Município e dá outras providências.', autores: 'Olívia Marchetti', situacao_legado: 'APROVADA' },
  { id: 'PR012', tipo: 'REQUERIMENTO', numero: 260, ano: 2023, ementa: 'Requer ao Executivo cópia dos contratos de publicidade e propaganda firmados no biênio.', autores: 'Sandra Ribeiro', situacao_legado: 'APROVADA' },
  { id: 'PR013', tipo: 'MOCAO', numero: 19, ano: 2023, ementa: 'Moção de Peso pelo falecimento da professora e fundadora da primeira escola municipal.', autores: 'Carla Mendes', situacao_legado: 'APROVADA' },
  { id: 'PR014', tipo: 'PROJETO_LEI', numero: 134, ano: 2023, ementa: 'Autoriza o Poder Executivo a firmar convênio com o Estado para ampliação do hospital municipal.', autores: 'Benedito Salgado', situacao_legado: 'REJEITADA' },
  { id: 'PR015', tipo: 'INDICACAO', numero: 82, ano: 2023, ementa: 'Indica a criação de ciclovia na Marginal do Rio Claro.', autores: 'Cida Ramalho|Eva Barbosa', situacao_legado: 'EM_TRAMITACAO' },
  { id: 'PR016', tipo: 'REQUERIMENTO', numero: 271, ano: 2024, ementa: 'Requer informações sobre o número de servidores comissionários por secretaria.', autores: 'Dorival Pinto', situacao_legado: 'APROVADA' },
  { id: 'PR017', tipo: 'PROJETO_LEI', numero: 140, ano: 2024, ementa: 'Institui a Semana Municipal de Incentivo à Leitura nas escolas da rede municipal.', autores: 'Gláucia Prado', situacao_legado: 'APROVADA' },
  { id: 'PR018', tipo: 'DECRETO_LEGISLATIVO', numero: 5, ano: 2024, ementa: 'Cria a Comissão Especial de Acompanhamento das Obras do Novo Terminal Rodoviário.', autores: 'Heitor Vasconcelos|Nelson Bandeira', situacao_legado: 'EM_TRAMITACAO' },
  { id: 'PR019', tipo: 'INDICACAO', numero: 90, ano: 2024, ementa: 'Indica ao Executivo a ampliação da iluminação LED no Distrito Industrial.', autores: 'Jorge Takahashi', situacao_legado: 'PAUTA' },
  { id: 'PR020', tipo: 'PROJETO_LEI', numero: 147, ano: 2024, ementa: 'Atualiza os valores das multas previstas na legislação municipal de trânsito.', autores: 'Francisco das Chagas', situacao_legado: 'ARQUIVADA' },
]

// ─── Sessões (2021-2024, todas ENCERRADA) ────────────────────────────────────
// S004 tem data_encerramento ANTES da data_abertura (erro realista de export).
const sessoes = [
  { id: 'S001', numero: 3, ano: 2021, tipo_legado: 'ORDINARIA', data_abertura: '2021-03-15 19:00:00', data_encerramento: '2021-03-15 21:30:00', status_legado: 'ENCERRADA' },
  { id: 'S002', numero: 7, ano: 2021, tipo_legado: 'ORDINARIA', data_abertura: '2021-05-10 19:00:00', data_encerramento: '2021-05-10 22:10:00', status_legado: 'ENCERRADA' },
  { id: 'S003', numero: 12, ano: 2022, tipo_legado: 'EXTRAORDINARIA', data_abertura: '2022-08-20 18:30:00', data_encerramento: '2022-08-20 20:05:00', status_legado: 'ENCERRADA' },
  { id: 'S004', numero: 2, ano: 2023, tipo_legado: 'SOLENE', data_abertura: '2023-04-25 18:00:00', data_encerramento: '2023-04-25 17:30:00', status_legado: 'ENCERRADA' },
  { id: 'S005', numero: 9, ano: 2023, tipo_legado: 'ORDINARIA', data_abertura: '2023-09-11 19:00:00', data_encerramento: '2023-09-11 21:50:00', status_legado: 'ENCERRADA' },
  { id: 'S006', numero: 15, ano: 2024, tipo_legado: 'ORDINARIA', data_abertura: '2024-11-18 19:00:00', data_encerramento: '2024-11-18 22:30:00', status_legado: 'ENCERRADA' },
]

// ─── Presenças (~70 linhas: 2 órfãs + 1 duplicidade) ─────────────────────────
const presencas: Array<{ id: string; sessao_id: string; parlamentar_id: string; presente: number }> = []
let presSeq = 0
const addPres = (sessaoId: string, parlId: string, presente: number) => {
  presencas.push({ id: `PRS${String(++presSeq).padStart(3, '0')}`, sessao_id: sessaoId, parlamentar_id: parlId, presente })
}
// S001 (2021): 11 presentes de 15
for (const p of parlamentares.slice(0, 11)) addPres('S001', p.id, 1)
addPres('S001', 'P012', 0)
addPres('S001', 'P013', 0)
// S002: 12 presentes
for (const p of parlamentares.slice(0, 12)) addPres('S002', p.id, 1)
// S003 (extraordinária): 9 presentes
for (const p of parlamentares.slice(0, 9)) addPres('S003', p.id, 1)
// S004 (solene): 13 presentes
for (const p of parlamentares.slice(0, 13)) addPres('S004', p.id, 1)
// S005: 11 presentes + 2 ausentes
for (const p of parlamentares.slice(0, 11)) addPres('S005', p.id, 1)
addPres('S005', 'P014', 0)
addPres('S005', 'P015', 0)
// S006: 10 presentes
for (const p of parlamentares.slice(0, 10)) addPres('S006', p.id, 1)
// Órfãs (parlamentar_id inexistente no export)
addPres('S002', 'PEXT01', 1)
addPres('S005', 'PEXT02', 1)
// Duplicidade: mesma pk de presença (linha repetida do export)
const dup = { ...presencas[0]! }
presencas.push(dup)

// ─── Votações (8; V006 com proposicao_id órfã) ───────────────────────────────
const votacoes = [
  { id: 'V001', sessao_id: 'S001', proposicao_id: 'PR001', modo_legado: 'NOMINAL', resultado_legado: 'APROVADA' },
  { id: 'V002', sessao_id: 'S001', proposicao_id: 'PR002', modo_legado: 'SIMBOLICA', resultado_legado: 'APROVADA' },
  { id: 'V003', sessao_id: 'S002', proposicao_id: 'PR003', modo_legado: 'NOMINAL', resultado_legado: 'REJEITADA' },
  { id: 'V004', sessao_id: 'S002', proposicao_id: 'PR004', modo_legado: 'SIMBOLICA', resultado_legado: 'APROVADA' },
  { id: 'V005', sessao_id: 'S003', proposicao_id: 'PR005', modo_legado: 'NOMINAL', resultado_legado: 'APROVADA' },
  { id: 'V006', sessao_id: 'S004', proposicao_id: 'PROP999', modo_legado: 'NOMINAL', resultado_legado: 'APROVADA' },
  { id: 'V007', sessao_id: 'S005', proposicao_id: 'PR011', modo_legado: 'SECRETA', resultado_legado: 'APROVADA' },
  { id: 'V008', sessao_id: 'S006', proposicao_id: 'PR017', modo_legado: 'NOMINAL', resultado_legado: 'APROVADA' },
]

// ─── Votos (60 linhas; 1 "NULL" legado + 1 órfão) ────────────────────────────
const votos: Array<{ id: string; votacao_id: string; parlamentar_id: string; voto: string }> = []
let votoSeq = 0
const addVoto = (votId: string, parlId: string, voto: string) => {
  votos.push({ id: `VT${String(++votoSeq).padStart(3, '0')}`, votacao_id: votId, parlamentar_id: parlId, voto })
}
const sim = ['SIM', 'SIM', 'SIM', 'SIM', 'SIM', 'NAO', 'ABSTENCAO'] // padrão aprovado
const rej = ['NAO', 'NAO', 'NAO', 'NAO', 'NAO', 'SIM', 'ABSTENCAO'] // padrão rejeitado
// V001 (nominal, aprovada) — 8 votos + 1 órfão de parlamentar
parlamentares.slice(0, 8).forEach((p, i) => addVoto('V001', p.id, sim[i % sim.length]!))
addVoto('V001', 'PEXT01', 'SIM')
// V002 (simbólica, aprovada) — 7 votos
parlamentares.slice(0, 7).forEach((p, i) => addVoto('V002', p.id, sim[i % sim.length]!))
// V003 (nominal, rejeitada) — 8 votos, 1 deles "NULL" (voto ausente legado)
parlamentares.slice(0, 8).forEach((p, i) => addVoto('V003', p.id, i === 4 ? 'NULL' : rej[i % rej.length]!))
// V004 (simbólica, aprovada) — 7 votos
parlamentares.slice(0, 7).forEach((p, i) => addVoto('V004', p.id, sim[i % sim.length]!))
// V005 (nominal, aprovada) — 7 votos
parlamentares.slice(0, 7).forEach((p, i) => addVoto('V005', p.id, sim[i % sim.length]!))
// V006 (proposição órfã — NÃO será importada) — 7 votos
parlamentares.slice(0, 7).forEach((p, i) => addVoto('V006', p.id, sim[i % sim.length]!))
// V007 (secreta, aprovada) — 8 votos
parlamentares.slice(0, 8).forEach((p, i) => addVoto('V007', p.id, sim[i % sim.length]!))
// V008 (nominal, aprovada) — 7 votos
parlamentares.slice(0, 7).forEach((p, i) => addVoto('V008', p.id, sim[i % sim.length]!))

// ─── Manifest + gravação ─────────────────────────────────────────────────────
const manifest = {
  system: 'PainelDeskLegis',
  version: '8.1',
  engine: 'HSQLDB',
  generatedAt: new Date().toISOString(),
  synthetic: true,
  note: 'Export FICTÍCIO gerado por scripts/generate-legacy-export.ts para demonstração do importador de migração (Fase 8). Nenhum dado real.',
  tables: [
    { name: 'parlamentares', file: 'parlamentares.csv', rows: parlamentares.length },
    { name: 'proposicoes', file: 'proposicoes.csv', rows: proposicoes.length },
    { name: 'sessoes', file: 'sessoes.csv', rows: sessoes.length },
    { name: 'presencas', file: 'presencas.csv', rows: presencas.length },
    { name: 'votacoes', file: 'votacoes.csv', rows: votacoes.length },
    { name: 'votos', file: 'votos.csv', rows: votos.length },
  ],
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(join(OUT_DIR, 'parlamentares.csv'), toCsv(parlamentares))
writeFileSync(join(OUT_DIR, 'proposicoes.csv'), toCsv(proposicoes))
writeFileSync(join(OUT_DIR, 'sessoes.csv'), toCsv(sessoes))
writeFileSync(join(OUT_DIR, 'presencas.csv'), toCsv(presencas))
writeFileSync(join(OUT_DIR, 'votacoes.csv'), toCsv(votacoes))
writeFileSync(join(OUT_DIR, 'votos.csv'), toCsv(votos))

console.log('Export sintético PainelDeskLegis 8.1 gerado em', OUT_DIR)
console.log(
  manifest.tables
    .map((t) => `  ${t.name.padEnd(14)} ${String(t.rows).padStart(3)} linhas`)
    .join('\n')
)
console.log(`  Total presenças ${presencas.length} (2 órfãs + 1 duplicada) · votos ${votos.length} (1 NULL + 1 órfão) · 1 votação com proposição órfã · 1 sessão com datas invertidas`)
