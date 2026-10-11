import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '../src/lib/db'
import { withMediaPathLease } from '../src/lib/server/media-path-lease'

let directory: string | undefined
let server: ReturnType<typeof Bun.serve> | undefined
afterAll(async () => {
  server?.stop(true)
  if (directory) await rm(directory, { recursive: true, force: true })
  await db.$disconnect()
})

describe('lease de caminho entre processos', () => {
  test('duas alterações simultâneas preservam ambos os destinos', async () => {
    directory = await mkdtemp(join(tmpdir(), 'legis-path-lease-'))
    const tenantId = 'test-path-lease'
    const path = 'session-concurrent'
    const file = join(directory, 'destinations.json')
    const first = 'rtmps://example.test/live#FIRST-SECRET'
    const second = 'rtmps://example.test/live#SECOND-SECRET'
    await writeFile(file, JSON.stringify([
      { tenantId, id: 'first', label: 'Primeiro', platform: 'youtube', dest: first },
      { tenantId, id: 'second', label: 'Segundo', platform: 'facebook', dest: second },
    ]), { mode: 0o600 })

    let forward: Array<{ dest: string }> = []
    let inFlight = 0
    let maxInFlight = 0
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/metrics') return new Response('')
        if (url.pathname.includes('/config/paths/get/')) {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          const snapshot = [...forward]
          // Mantém a janela de leitura aberta para expor a corrida sem o lease.
          await Bun.sleep(500)
          inFlight--
          return Response.json({ forward: snapshot })
        }
        if (url.pathname.includes('/config/paths/patch/')) {
          forward = (await request.json() as { forward: Array<{ dest: string }> }).forward
          return Response.json({ status: 'ok' })
        }
        return new Response('not found', { status: 404 })
      },
    })
    const environment = {
      ...process.env,
      MEDIA_DESTINATIONS_FILE: file,
      MEDIA_CONTROL_URL: `http://127.0.0.1:${server.port}`,
    }
    const run = (destinationId: string) => Bun.spawn(
      [process.execPath, 'tests/fixtures/media-path-worker.ts', tenantId, path, destinationId],
      { cwd: process.cwd(), env: environment, stdout: 'pipe', stderr: 'pipe' },
    )
    const children = [run('first'), run('second')]
    const exits = await Promise.all(children.map((child) => child.exited))
    const errors = await Promise.all(children.map(async (child) => await new Response(child.stderr).text()))
    expect(exits).toEqual([0, 0])
    expect(errors.join('')).toBe('')
    expect(forward.map((item) => item.dest).sort()).toEqual([first, second].sort())
    expect(maxInFlight).toBe(1)
    expect(await db.mediaPathLease.findUnique({ where: { path } })).toMatchObject({ owner: '' })
    expect(JSON.stringify(await db.mediaPathLease.findMany())).not.toContain('SECRET')
  })

  test('recupera lease vencido e libera após falha da operação', async () => {
    const path = `session-recovered-${crypto.randomUUID()}`
    await db.mediaPathLease.create({ data: { path, owner: 'worker-interrompido', leaseUntil: new Date(0) } })
    await expect(withMediaPathLease(path, async () => { throw new Error('falha simulada') })).rejects.toThrow('falha simulada')
    expect(await db.mediaPathLease.findUniqueOrThrow({ where: { path } })).toMatchObject({ owner: '' })
    expect(await withMediaPathLease(path, async () => 'recuperado')).toBe('recuperado')
  })
})
