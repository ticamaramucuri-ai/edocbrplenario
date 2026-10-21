/**
 * Guarda de banco para a suíte de testes.
 *
 * Achado que motivou o módulo: `bun test tests/<arquivo>.test.ts` executado
 * direto importa `@/lib/db`, lê o `DATABASE_URL` do `.env.local` e escreve na
 * base de desenvolvimento (`db/custom.db`). Só os wrappers `scripts/test-*.sh`
 * isolam o banco.
 *
 * Roda de duas formas:
 * - como função, conferida por `tests/database-guard.test.ts`;
 * - como preload da suíte (`bunfig.toml`), que falha a execução inteira antes
 *   de qualquer teste tocar o Prisma.
 */
import { resolve, sep } from 'path'

const VARIAVEL_ESCAPE = 'EDOCBR_ALLOW_DEV_DB'

/**
 * Caminhos de arquivo que a URL pode designar. Prisma resolve caminho relativo
 * contra o diretório do schema (`prisma/`) — o `.env.local` desta instalação usa
 * `file:../db/custom.db` justamente por isso. Conferimos também a raiz do
 * repositório para não deixar brecha em `file:./db/custom.db`.
 */
function caminhosCandidatos(databaseUrl: string, repoRoot: string): string[] {
  const url = databaseUrl.trim()
  if (!url.toLowerCase().startsWith('file:')) return []

  let caminho = url.slice('file:'.length).split('?')[0]
  if (caminho.startsWith('//')) caminho = caminho.slice(2)
  if (!caminho) return []

  if (caminho.startsWith('/')) return [resolve(caminho)]
  return [resolve(repoRoot, 'prisma', caminho), resolve(repoRoot, caminho)]
}

/**
 * Lança quando a URL aponta para `db/` do repositório e o escape explícito não
 * está ligado. PostgreSQL de homologação e arquivos fora de `db/` passam.
 */
export function assertDisposableDatabase(databaseUrl: string, repoRoot: string): void {
  if (process.env[VARIAVEL_ESCAPE] === '1') return

  const protegido = resolve(repoRoot, 'db')
  for (const candidato of caminhosCandidatos(databaseUrl, repoRoot)) {
    if (candidato === protegido || candidato.startsWith(protegido + sep)) {
      throw new Error(
        `DATABASE_URL aponta para a base de desenvolvimento do repositório (${candidato}). ` +
          'Teste só roda em banco descartável: use um wrapper scripts/test-*.sh, aponte ' +
          `DATABASE_URL para um arquivo temporário, ou defina ${VARIAVEL_ESCAPE}=1 para ` +
          'assumir a escrita na base de desenvolvimento.',
      )
    }
  }
}

if (process.env.DATABASE_URL) {
  assertDisposableDatabase(process.env.DATABASE_URL, resolve(import.meta.dir, '..'))
}
