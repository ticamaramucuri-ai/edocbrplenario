import { expect, test } from 'bun:test'
import { assertDisposableDatabase } from './guard-dev-database'

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

test('nomeia a variável e o caminho na mensagem', () => {
  expect(() => assertDisposableDatabase('file:/repo/db/custom.db', root)).toThrow(
    /DATABASE_URL[\s\S]*EDOCBR_ALLOW_DEV_DB/,
  )
})
