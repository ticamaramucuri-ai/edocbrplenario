import { expect, test } from 'bun:test'
import { createServer } from 'net'
import { db } from '@/lib/db'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('porta indisponível')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

test('scheduler PostgreSQL inicia e mantém health e execução manual por HTTP', async () => {
  await db.scheduledJob.upsert({ where: { kind: 'tenant.health_snapshot' },
    create: { kind: 'tenant.health_snapshot', title: 'Snapshot de saúde', active: false },
    update: { active: false } })
  const port = await freePort()
  const child = Bun.spawn(['bun', 'mini-services/scheduler/postgres.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, SCHEDULER_PORT: String(port) },
    stdout: 'ignore', stderr: 'pipe',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`${base}/health`)
        if (response.ok) { ready = true; break }
      } catch { /* startup */ }
      if (child.exitCode !== null) break
      await Bun.sleep(100)
    }
    expect(ready).toBe(true)
    const health = await (await fetch(`${base}/health`)).json()
    expect(health).toMatchObject({ ok: true, service: 'scheduler', provider: 'postgresql' })
    expect((await fetch(`${base}/jobs/desconhecido/run`, { method: 'POST' })).status).toBe(404)
    const result = await (await fetch(`${base}/jobs/tenant.health_snapshot/run`, { method: 'POST' })).json()
    expect(result.status).toBe('ok')
    expect(result.note).toContain('capturados')
  } finally {
    child.kill('SIGTERM')
    await child.exited
    await db.scheduledJob.deleteMany({ where: { kind: 'tenant.health_snapshot' } })
    await db.$disconnect()
  }
})
