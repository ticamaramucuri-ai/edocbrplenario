import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, test } from 'bun:test'
import { assertDisposableDatabase, urlDeBancoConfigurada } from './guard-dev-database'

const root = '/repo'

test('recusa a base de desenvolvimento do repositório', () => {
  expect(() => assertDisposableDatabase('file:/repo/db/custom.db', root)).toThrow(/descartável/)
})

test('aceita banco temporário', () => {
  expect(() => assertDisposableDatabase('file:/tmp/edocbr-x.db', root)).not.toThrow()
})

test('aceita PostgreSQL de homologação', () => {
  expect(() => assertDisposableDatabase('postgresql://edocbr_stage@127.0.0.1:55432/edocbr_stage', root)).not.toThrow()
})

test('permite escape explícito', () => {
  process.env.EDOCBR_ALLOW_DEV_DB = '1'
  expect(() => assertDisposableDatabase('file:/repo/db/custom.db', root)).not.toThrow()
  delete process.env.EDOCBR_ALLOW_DEV_DB
})

test('recusa caminho relativo do .env.local resolvido contra prisma/', () => {
  expect(() => assertDisposableDatabase('file:../db/custom.db?connection_limit=1', root)).toThrow(
    /descartável/,
  )
})

test('recusa caminho relativo resolvido contra a raiz', () => {
  expect(() => assertDisposableDatabase('file:./db/custom.db', root)).toThrow(/descartável/)
})

/** Executa sem `DATABASE_URL` no ambiente e devolve o valor anterior ao final. */
function semUrlNoAmbiente<T>(corpo: () => T): T {
  const anterior = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    return corpo()
  } finally {
    if (anterior === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = anterior
  }
}

test('lê a URL do .env.local quando o ambiente não a traz', () => {
  const diretorio = mkdtempSync(join(tmpdir(), 'edocbr-guarda-'))
  try {
    semUrlNoAmbiente(() => {
      writeFileSync(
        join(diretorio, '.env.local'),
        'DEFAULT_TENANT_SLUG="camara-mucuri-ba"\nDATABASE_URL="file:../db/custom.db?x=1"\n',
      )
      expect(urlDeBancoConfigurada(diretorio)).toBe('file:../db/custom.db?x=1')
      expect(() => assertDisposableDatabase(urlDeBancoConfigurada(diretorio)!, diretorio)).toThrow(
        /descartável/,
      )
    })
  } finally {
    rmSync(diretorio, { recursive: true, force: true })
  }
})

test('sem arquivo de ambiente e sem variável, não há URL a conferir', () => {
  const diretorio = mkdtempSync(join(tmpdir(), 'edocbr-guarda-'))
  try {
    semUrlNoAmbiente(() => {
      expect(urlDeBancoConfigurada(diretorio)).toBeNull()
    })
  } finally {
    rmSync(diretorio, { recursive: true, force: true })
  }
})

test('variável do ambiente vence o arquivo', () => {
  const diretorio = mkdtempSync(join(tmpdir(), 'edocbr-guarda-'))
  try {
    writeFileSync(join(diretorio, '.env.local'), 'DATABASE_URL="file:../db/custom.db"\n')
    process.env.DATABASE_URL = 'file:/tmp/edocbr-x.db'
    expect(urlDeBancoConfigurada(diretorio)).toBe('file:/tmp/edocbr-x.db')
  } finally {
    delete process.env.DATABASE_URL
    rmSync(diretorio, { recursive: true, force: true })
  }
})

test('recusa symlink que aponta para a base de desenvolvimento', () => {
  const diretorio = mkdtempSync(join(tmpdir(), 'edocbr-guarda-'))
  const raiz = mkdtempSync(join(tmpdir(), 'edocbr-raiz-'))
  try {
    mkdirSync(join(raiz, 'db'))
    const real = join(raiz, 'db', 'custom.db')
    writeFileSync(real, '')
    const atalho = join(diretorio, 'base.db')
    symlinkSync(real, atalho)
    expect(() => assertDisposableDatabase(`file:${atalho}`, raiz)).toThrow(/descartável/)
  } finally {
    rmSync(diretorio, { recursive: true, force: true })
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('nomeia a variável e o caminho na mensagem', () => {
  expect(() => assertDisposableDatabase('file:/repo/db/custom.db', root)).toThrow(
    /DATABASE_URL[\s\S]*EDOCBR_ALLOW_DEV_DB/,
  )
})
