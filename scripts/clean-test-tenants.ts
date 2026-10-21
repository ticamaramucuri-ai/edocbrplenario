/**
 * Remove da base SQLite os tenants criados por teste, em cascata e dentro de
 * uma transação. Motivo: a base de desenvolvimento acumulou tenants sintéticos
 * (`attendance-*`, `tally-*`, `mail-*`, `camara-a/b-*`) ao lado dos reais.
 *
 * Uso:
 *   bun scripts/clean-test-tenants.ts            # simulação (padrão)
 *   bun scripts/clean-test-tenants.ts --apply    # grava backup e remove
 *   bun scripts/clean-test-tenants.ts --database db/custom.db
 *
 * A remoção não depende de `onDelete: Cascade` — a maioria das relações de
 * Tenant no schema é restritiva. O roteiro percorre o grafo de chaves
 * estrangeiras do próprio arquivo e apaga tudo que é alcançável, com
 * `defer_foreign_keys` ligado: se sobrar referência, o COMMIT falha.
 */
import { Database } from 'bun:sqlite'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

const RAIZ = resolve(import.meta.dir, '..')
const LOTE = 400

export const SLUGS_PROTEGIDOS = ['camara-vila-nova', 'camara-serra-azul', 'camara-mucuri-ba']

export const PADRAO_TENANT_DE_TESTE =
  /^(attendance|self-attendance|tally|mail|scan-mail|camara-a|camara-b)-[0-9a-f-]{8,}$/

export type MotivoDescarte = 'padrao_de_teste' | 'fora_da_lista_de_reais'

export interface TenantDescartavel {
  id: string
  slug: string
  name: string
  motivo: MotivoDescarte
}

export interface PlanoDeLimpeza {
  caminho: string
  tenants: TenantDescartavel[]
  linhasPorTabela: Record<string, number>
  totalDeLinhas: number
}

/** Caminho do arquivo SQLite designado pela URL do Prisma. */
export function caminhoDoBancoSqlite(databaseUrl: string): string {
  const url = databaseUrl.trim()
  if (!url.toLowerCase().startsWith('file:')) return resolve(RAIZ, 'db/custom.db')

  let caminho = url.slice('file:'.length).split('?')[0]
  if (caminho.startsWith('//')) caminho = caminho.slice(2)
  if (!caminho) return resolve(RAIZ, 'db/custom.db')
  if (caminho.startsWith('/')) return resolve(caminho)

  // Prisma resolve caminho relativo contra o diretório do schema.
  const contraPrisma = resolve(RAIZ, 'prisma', caminho)
  return existsSync(contraPrisma) ? contraPrisma : resolve(RAIZ, caminho)
}

export function ehTenantDescartavel(slug: string): boolean {
  return motivoDeDescarte(slug) !== null
}

function motivoDeDescarte(slug: string): MotivoDescarte | null {
  if (SLUGS_PROTEGIDOS.includes(slug)) return null
  if (PADRAO_TENANT_DE_TESTE.test(slug)) return 'padrao_de_teste'
  return 'fora_da_lista_de_reais'
}

interface Filho {
  tabela: string
  coluna: string
  colunaPai: string
}

function tabelas(banco: Database): string[] {
  const linhas = banco
    .query<{ name: string }, []>(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_prisma%'",
    )
    .all()
  return linhas.map((linha) => linha.name)
}

/** Coluna de chave primária simples; `rowid` quando composta ou ausente. */
function colunaChave(banco: Database, tabela: string): string {
  const colunas = banco
    .query<{ name: string; pk: number }, []>(`pragma table_info("${tabela}")`)
    .all()
  const chaves = colunas.filter((coluna) => coluna.pk > 0)
  return chaves.length === 1 ? chaves[0].name : 'rowid'
}

function grafoDeFilhos(banco: Database): Map<string, Filho[]> {
  const grafo = new Map<string, Filho[]>()
  for (const tabela of tabelas(banco)) {
    const chaves = banco
      .query<{ table: string; from: string; to: string | null }, []>(
        `pragma foreign_key_list("${tabela}")`,
      )
      .all()
    for (const chave of chaves) {
      const colunaPai = chave.to ?? colunaChave(banco, chave.table)
      const atual = grafo.get(chave.table) ?? []
      atual.push({ tabela, coluna: chave.from, colunaPai })
      grafo.set(chave.table, atual)
    }
  }
  return grafo
}

function emLotes<T>(valores: T[]): T[][] {
  const lotes: T[][] = []
  for (let inicio = 0; inicio < valores.length; inicio += LOTE) {
    lotes.push(valores.slice(inicio, inicio + LOTE))
  }
  return lotes
}

/**
 * Linhas alcançáveis a partir dos tenants condenados, por tabela.
 * Percorre o grafo em largura e ignora valor já coletado (cobre auto-relação).
 */
function linhasAlcancaveis(
  banco: Database,
  idsDeTenant: string[],
): Map<string, { chave: string; valores: Set<string> }> {
  const grafo = grafoDeFilhos(banco)
  const coletadas = new Map<string, { chave: string; valores: Set<string> }>()
  coletadas.set('Tenant', { chave: colunaChave(banco, 'Tenant'), valores: new Set(idsDeTenant) })

  const fila: Array<{ tabela: string; valores: string[] }> = [
    { tabela: 'Tenant', valores: idsDeTenant },
  ]

  while (fila.length > 0) {
    const atual = fila.shift()!
    const chavePai = coletadas.get(atual.tabela)!.chave
    for (const filho of grafo.get(atual.tabela) ?? []) {
      const chaveFilho = colunaChave(banco, filho.tabela)
      const novos: string[] = []
      for (const lote of emLotes(atual.valores)) {
        const marcadores = lote.map(() => '?').join(', ')
        const encontrados = banco
          .query<{ valor: string }, string[]>(
            `select f."${chaveFilho}" as valor from "${filho.tabela}" f ` +
              `join "${atual.tabela}" p on f."${filho.coluna}" = p."${filho.colunaPai}" ` +
              `where p."${chavePai}" in (${marcadores})`,
          )
          .all(...lote)
        const registro =
          coletadas.get(filho.tabela) ?? { chave: chaveFilho, valores: new Set<string>() }
        coletadas.set(filho.tabela, registro)
        for (const linha of encontrados) {
          const valor = String(linha.valor)
          if (registro.valores.has(valor)) continue
          registro.valores.add(valor)
          novos.push(valor)
        }
      }
      if (novos.length > 0) fila.push({ tabela: filho.tabela, valores: novos })
    }
  }

  return coletadas
}

function tenantsDescartaveis(banco: Database): TenantDescartavel[] {
  const linhas = banco
    .query<{ id: string; slug: string; name: string }, []>(
      'select id, slug, name from "Tenant" order by slug',
    )
    .all()
  return linhas.flatMap((linha) => {
    const motivo = motivoDeDescarte(linha.slug)
    return motivo === null ? [] : [{ ...linha, motivo }]
  })
}

function montarPlano(banco: Database, caminho: string): PlanoDeLimpeza {
  const condenados = tenantsDescartaveis(banco)
  const linhasPorTabela: Record<string, number> = {}
  let totalDeLinhas = 0

  if (condenados.length > 0) {
    const alcancaveis = linhasAlcancaveis(
      banco,
      condenados.map((tenant) => tenant.id),
    )
    for (const [tabela, registro] of alcancaveis) {
      if (registro.valores.size === 0) continue
      linhasPorTabela[tabela] = registro.valores.size
      totalDeLinhas += registro.valores.size
    }
  }

  return { caminho, tenants: condenados, linhasPorTabela, totalDeLinhas }
}

/** Plano de remoção, sem tocar no arquivo. */
export function planejarLimpeza(caminho: string): PlanoDeLimpeza {
  const banco = new Database(caminho, { readonly: true })
  try {
    return montarPlano(banco, caminho)
  } finally {
    banco.close()
  }
}

/** Remove as linhas do plano em uma transação; devolve o que foi removido. */
export function executarLimpeza(caminho: string): PlanoDeLimpeza {
  const banco = new Database(caminho)
  try {
    banco.run('pragma foreign_keys = on')
    const plano = montarPlano(banco, caminho)
    if (plano.tenants.length === 0) return plano

    const alcancaveis = linhasAlcancaveis(
      banco,
      plano.tenants.map((tenant) => tenant.id),
    )
    const ordem = [...alcancaveis.keys()].filter((tabela) => tabela !== 'Tenant').reverse()

    const remover = banco.transaction(() => {
      banco.run('pragma defer_foreign_keys = on')
      for (const tabela of [...ordem, 'Tenant']) {
        const registro = alcancaveis.get(tabela)!
        for (const lote of emLotes([...registro.valores])) {
          const marcadores = lote.map(() => '?').join(', ')
          banco.run(
            `delete from "${tabela}" where "${registro.chave}" in (${marcadores})`,
            lote as never,
          )
        }
      }
    })
    remover()
    return plano
  } finally {
    banco.close()
  }
}

function gravarBackup(): void {
  const destino = resolve(
    RAIZ,
    `db/bundle-clean-test-tenants-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`,
  )
  const execucao = spawnSync(
    'python3',
    ['scripts/backup-bundle.py', 'create', '--database', 'sqlite', '--output', destino],
    { cwd: RAIZ, stdio: 'inherit' },
  )
  if (execucao.status !== 0) {
    throw new Error(`Backup falhou (${execucao.status}); nada foi removido.`)
  }
  console.log(`Backup gravado em ${destino}`)
}

function principal(): void {
  const argumentos = process.argv.slice(2)
  const aplicar = argumentos.includes('--apply')
  const indiceBanco = argumentos.indexOf('--database')
  const caminho =
    indiceBanco >= 0
      ? resolve(RAIZ, argumentos[indiceBanco + 1])
      : caminhoDoBancoSqlite(process.env.DATABASE_URL ?? '')

  if (!existsSync(caminho)) {
    console.error(`Banco não encontrado: ${caminho}`)
    process.exit(2)
  }

  const plano = planejarLimpeza(caminho)
  console.log(`Banco: ${plano.caminho}`)
  if (plano.tenants.length === 0) {
    console.log('Nenhum tenant descartável.')
    return
  }
  for (const tenant of plano.tenants) {
    console.log(`  ${tenant.slug} (${tenant.motivo})`)
  }
  console.log(`Tenants: ${plano.tenants.length} · linhas: ${plano.totalDeLinhas}`)
  for (const [tabela, linhas] of Object.entries(plano.linhasPorTabela).sort()) {
    console.log(`  ${tabela}: ${linhas}`)
  }

  if (!aplicar) {
    console.log('Simulação (padrão). Use --apply para remover.')
    return
  }

  gravarBackup()
  const removido = executarLimpeza(caminho)
  console.log(`Removidos ${removido.tenants.length} tenants e ${removido.totalDeLinhas} linhas.`)
}

if (import.meta.main) principal()
