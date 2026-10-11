/**
 * Fonte legada sintética (Fase 8) — leitura de `upload/legacy/`
 * (export fictício do PainelDeskLegis 8.1 / HSQLDB em CSV).
 * Parse manual de CSV com aspas — SEM dependências novas.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const LEGACY_DIR = join(process.cwd(), 'upload', 'legacy')

/** Parser CSV manual: suporta aspas, vírgulas dentro de aspas e "" escapado. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const src = text.replace(/^\uFEFF/, '') // remove BOM se houver
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    if (row.length > 1 || (row[0] ?? '').trim() !== '') rows.push(row)
    row = []
  }
  while (i < src.length) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

function csvToObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const headers = rows[0]!.map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? ''
    })
    return obj
  })
}

export type LegacyManifest = {
  system: string
  version: string
  engine?: string
  generatedAt: string
  synthetic?: boolean
  tables: Array<{ name: string; file: string; rows: number }>
}

export type LegacyParlamentar = { id: string; nome: string; partido: string; cargo_mesa: string; ativo: string }
export type LegacyProposicao = { id: string; tipo: string; numero: string; ano: string; ementa: string; autores: string; situacao_legado: string }
export type LegacySessao = { id: string; numero: string; ano: string; tipo_legado: string; data_abertura: string; data_encerramento: string; status_legado: string }
export type LegacyPresenca = { id: string; sessao_id: string; parlamentar_id: string; presente: string }
export type LegacyVotacao = { id: string; sessao_id: string; proposicao_id: string; modo_legado: string; resultado_legado: string }
export type LegacyVoto = { id: string; votacao_id: string; parlamentar_id: string; voto: string }

export type LegacySource = {
  manifest: LegacyManifest
  parlamentares: LegacyParlamentar[]
  proposicoes: LegacyProposicao[]
  sessoes: LegacySessao[]
  presencas: LegacyPresenca[]
  votacoes: LegacyVotacao[]
  votos: LegacyVoto[]
}

async function readCsv(name: string): Promise<string> {
  return readFile(join(LEGACY_DIR, name), 'utf-8')
}

/** Lê todo o pacote legado do disco (manifest + 6 CSVs). */
export async function readLegacySource(): Promise<LegacySource> {
  const manifest = JSON.parse(await readFile(join(LEGACY_DIR, 'manifest.json'), 'utf-8')) as LegacyManifest
  const [parlamentares, proposicoes, sessoes, presencas, votacoes, votos] = await Promise.all([
    readCsv('parlamentares.csv'),
    readCsv('proposicoes.csv'),
    readCsv('sessoes.csv'),
    readCsv('presencas.csv'),
    readCsv('votacoes.csv'),
    readCsv('votos.csv'),
  ])
  return {
    manifest,
    parlamentares: csvToObjects(parlamentares) as unknown as LegacyParlamentar[],
    proposicoes: csvToObjects(proposicoes) as unknown as LegacyProposicao[],
    sessoes: csvToObjects(sessoes) as unknown as LegacySessao[],
    presencas: csvToObjects(presencas) as unknown as LegacyPresenca[],
    votacoes: csvToObjects(votacoes) as unknown as LegacyVotacao[],
    votos: csvToObjects(votos) as unknown as LegacyVoto[],
  }
}

/** "2021-03-15 19:00:00" → Date (null quando inválida). */
export function parseLegacyDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'))
  return Number.isNaN(date.getTime()) ? null : date
}
