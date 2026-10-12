import { expect, test } from 'bun:test'

test('worker SMTP expõe health só em loopback durante processamento', async () => {
  const port = 37000 + Math.floor(Math.random() * 20000)
  const worker = Bun.spawn(['bun', 'scripts/mail-worker.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, SMTP_HOST: '127.0.0.1', SMTP_FROM: 'ensaio@example.invalid',
      PUBLIC_BASE_URL: 'http://localhost:3000', MAIL_WORKER_HEALTH_PORT: String(port) },
    stdout: 'pipe', stderr: 'pipe',
  })
  try {
    let response: Response | null = null
    for (let attempt = 0; attempt < 40; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) }); break }
      catch { await Bun.sleep(100) }
    }
    if (!response) {
      worker.kill('SIGTERM')
      await worker.exited
      const stderr = await new Response(worker.stderr).text()
      throw new Error(`Worker não iniciou health: ${stderr.slice(0, 500)}`)
    }
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect((await fetch(`http://127.0.0.1:${port}/unknown`)).status).toBe(404)
  } finally {
    worker.kill('SIGTERM')
    await worker.exited
  }
})
