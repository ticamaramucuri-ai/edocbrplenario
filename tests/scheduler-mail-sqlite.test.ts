import { afterAll, expect, test } from 'bun:test'
import { db } from '@/lib/db'

afterAll(async () => { await db.$disconnect() })

test('scheduler SQLite alerta fila de correio por Câmara sem duplicar', async () => {
  const suffix = crypto.randomUUID()
  const now = new Date()
  const a = await db.tenant.create({ data: { slug: `scan-mail-a-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const b = await db.tenant.create({ data: { slug: `scan-mail-b-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const subA = await db.citizenSubscription.create({ data: { tenantId: a.id, email: `a-${suffix}@example.invalid`, targetKind: 'session', targetId: 'ensaio', token: crypto.randomUUID() } })
  const subB = await db.citizenSubscription.create({ data: { tenantId: b.id, email: `b-${suffix}@example.invalid`, targetKind: 'session', targetId: 'ensaio', token: crypto.randomUUID() } })
  await db.mailDelivery.create({ data: { tenantId: a.id, subscriptionId: subA.id, tokenHash: 'hash-a', status: 'dead' } })
  await db.mailDelivery.create({ data: { tenantId: b.id, subscriptionId: subB.id, tokenHash: 'hash-b', createdAt: new Date(now.getTime() - 16 * 60_000) } })
  const port = 37000 + Math.floor(Math.random() * 20000)
  const databasePath = (process.env.DATABASE_URL ?? '').replace(/^file:/, '').split('?')[0]
  const server = Bun.spawn(['bun', 'mini-services/scheduler/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, SCHEDULER_DB_PATH: databasePath, SCHEDULER_PORT: String(port) },
    stdout: 'pipe', stderr: 'pipe',
  })
  try {
    let ready = false
    for (let attempt = 0; attempt < 40; attempt++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) })).ok; if (ready) break }
      catch { await Bun.sleep(100) }
    }
    expect(ready).toBe(true)
    const run = async () => fetch(`http://127.0.0.1:${port}/jobs/alert.scan/run`, { method: 'POST' })
    expect((await (await run()).json()).status).toBe('ok')
    expect((await (await run()).json()).status).toBe('ok')
    const alerts = await db.platformAlert.findMany({ where: { kind: { in: ['mail.dead_letter', 'mail.backlog'] } } })
    const own = alerts.filter((alert) => [a.id, b.id].includes((JSON.parse(alert.meta) as { tenantId: string }).tenantId))
    expect(own).toHaveLength(2)
    const keyed = own.map((alert) => ({ kind: alert.kind, tenantId: (JSON.parse(alert.meta) as { tenantId: string }).tenantId }))
    expect(keyed).toContainEqual({ kind: 'mail.dead_letter', tenantId: a.id })
    expect(keyed).toContainEqual({ kind: 'mail.backlog', tenantId: b.id })
    expect(JSON.stringify(alerts)).not.toContain(subA.email)
    expect(JSON.stringify(alerts)).not.toContain(subB.email)
  } finally {
    server.kill('SIGTERM')
    await server.exited
  }
})
