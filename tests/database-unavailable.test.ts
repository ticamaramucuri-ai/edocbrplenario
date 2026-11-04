import { expect, test } from 'bun:test'
import { apiHandler } from '../src/lib/server/errors'

test('pool indisponível responde 503 sem confirmar a operação', async () => {
  const handler = apiHandler(async () => {
    throw Object.assign(new Error('connection pool timeout'), { code: 'P2024' })
  })
  const response = await handler(new Request('http://localhost/api/v1/sessions'), {} as never)
  const body = await response.json()
  expect(response.status).toBe(503)
  expect(body.code).toBe('DATABASE_UNAVAILABLE')
  expect(body.detail).toContain('Verifique o estado')
})

test('erro inesperado mantém resposta interna', async () => {
  const handler = apiHandler(async () => { throw new Error('bug') })
  const response = await handler(new Request('http://localhost/api/v1/sessions'), {} as never)
  expect(response.status).toBe(500)
})
