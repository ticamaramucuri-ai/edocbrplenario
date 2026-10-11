import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { hitRateLimit } from '@/lib/server/rate-limit'

afterAll(async () => { await db.$disconnect() })

test('limite compartilhado em PostgreSQL admite apenas a cota sob concorrência', async () => {
  const bucket = `test:${crypto.randomUUID()}`
  const key = 'ip-de-ensaio'
  const results = await Promise.all(Array.from({ length: 8 }, () => hitRateLimit(bucket, key, 3, 60_000)))
  expect(results.filter(result => result.allowed)).toHaveLength(3)
  expect(results.filter(result => !result.allowed)).toHaveLength(5)
  expect(results.filter(result => !result.allowed).every(result => result.retryAfterSeconds > 0)).toBe(true)
  const keyHash = createHash('sha256').update(`${bucket}\0${key}`).digest('hex')
  expect(await db.rateLimitHit.count({ where: { keyHash } })).toBe(3)
  expect((await hitRateLimit(bucket, 'outro-ip', 3, 60_000)).allowed).toBe(true)
})
