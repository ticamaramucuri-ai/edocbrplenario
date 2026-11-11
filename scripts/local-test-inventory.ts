#!/usr/bin/env bun
/** Inventory existing local test files by functional area; read-only, no DB or network access. */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const testsRoot = join(root, 'tests')
const groups: Array<[string, RegExp]> = [
  ['Acesso, tenants e dados', /^(auth-(session|mfa)-|database|tenant|platform|demo|bootstrap|clean|seed)/],
  ['Integração PostgreSQL e builds locais', /^(postgres-services-e2e|python-runtime-|database-runtime-build)/],
  ['Estrutura legislativa', /^(legislature|deliberative-roster|parliamentarian|party)/],
  ['Sessão, pauta e convocação', /^(session|agenda|pending-checkin|speech-timer)/],
  ['Matérias e processo legislativo', /^matter-(related-graph|protocol-flow|deadlines-outcomes|attachment)/],
  ['Presença e plenário', /^(attendance|voting|symbolic-tally|deliberation|official-closure)/],
  ['Telão e tempo real', /^(display|realtime)/],
  ['Servidor e transferência local', /^(local-|session-transfer|session-authority)/],
  ['Documentos, relatório e mídia', /^(recording|media-|voting-report)/],
  ['Correio, agenda e webhooks', /^(mail|scheduler|webhook)/],
  ['Busca e analytics', /^(search|analytics)/],
  ['Operação, capacidade e segurança', /^(rate-limit|pilot-preflight|session-capacity|official-configuration|test-backup|test-prune|test_asset_audit)/],
  ['Staging: revisar antes de incluir em suíte local', /^test[-_]staging[-_]/],
]

function groupFor(name: string): string {
  return groups.find(([, pattern]) => pattern.test(name))?.[0] ?? 'Revisão manual necessária'
}

async function main(): Promise<void> {
  const entries = (await readdir(testsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(test\.ts|test\.tsx|sh|py)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const grouped = new Map<string, string[]>()
  for (const name of entries) {
    const group = groupFor(name)
    grouped.set(group, [...(grouped.get(group) ?? []), name])
  }

  const report = {
    generatedAt: new Date().toISOString(),
    repositorySha: Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD']).stdout.toString().trim(),
    scope: 'File inventory only: presence of a test file does not prove feature coverage or a passing result.',
    totalFiles: entries.length,
    unclassified: grouped.get('Revisão manual necessária') ?? [],
    groups: Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))),
  }

  const json = process.argv.includes('--json')
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`# Inventário local de testes — ${report.repositorySha || 'SHA indisponível'}`)
    console.log(`\nArquivos encontrados: ${report.totalFiles}`)
    console.log('\n> Inventário de nomes: não comprova cobertura nem execução aprovada. Este comando é somente leitura e não acessa banco ou rede.\n')
    for (const [group, names] of Object.entries(report.groups)) {
      console.log(`## ${group} (${names.length})`)
      for (const name of names) console.log(`- tests/${name}`)
      console.log('')
    }
  }
  if (process.argv.includes('--check') && report.unclassified.length) {
    console.error(`Há ${report.unclassified.length} arquivos sem classificação manual.`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha ao inventariar arquivos de teste.')
  process.exitCode = 1
})
