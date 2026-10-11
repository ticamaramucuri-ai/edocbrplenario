import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { destinationSnapshot, loadMediaDestinations, recordingSnapshot, setDestinationEnabled } from '../src/lib/server/media-control'
import { PERMISSIONS } from '../src/lib/server/rbac'

const originalFetch = globalThis.fetch
const originalFile = process.env.MEDIA_DESTINATIONS_FILE
const originalUrl = process.env.MEDIA_CONTROL_URL
let directory: string | undefined

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalFile === undefined) delete process.env.MEDIA_DESTINATIONS_FILE
  else process.env.MEDIA_DESTINATIONS_FILE = originalFile
  if (originalUrl === undefined) delete process.env.MEDIA_CONTROL_URL
  else process.env.MEDIA_CONTROL_URL = originalUrl
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'legis-destinations-'))
  const file = join(directory, 'destinations.json')
  await writeFile(file, JSON.stringify([
    { tenantId: 'camara-a', id: 'youtube', label: 'YouTube', platform: 'youtube', dest: 'rtmps://example.test/live#SEGREDO-123' },
    { tenantId: 'camara-b', id: 'youtube', label: 'Outra Câmara', platform: 'youtube', dest: 'rtmps://example.test/live#OUTRO-SEGREDO' },
  ]), { mode: 0o600 })
  process.env.MEDIA_DESTINATIONS_FILE = file
  process.env.MEDIA_CONTROL_URL = 'http://127.0.0.1:9997'
  return file
}

describe('controlador de destinos de mídia', () => {
  test('papel audiovisual opera mídia sem permissões deliberativas', () => {
    expect(PERMISSIONS['media.manage']).toContain('media_operator')
    for (const action of ['session.transition', 'attendance.write', 'voting.write', 'vote.cast']) {
      expect(PERMISSIONS[action]).not.toContain('media_operator')
    }
  })

  test('isola destinos por Câmara e recusa arquivo com leitura pública', async () => {
    const file = await setup()
    expect((await loadMediaDestinations('camara-a')).map((d) => d.id)).toEqual(['youtube'])
    const { chmod } = await import('node:fs/promises')
    await chmod(file, 0o644)
    await expect(loadMediaDestinations('camara-a')).rejects.toMatchObject({ code: 'MEDIA_CONTROL_UNAVAILABLE' })
  })

  test('altera só o destino escolhido e não retorna a chave ao cliente', async () => {
    await setup()
    const forward: Array<{ dest: string }> = [{ dest: 'rtmps://other.test/live#OUTRO' }]
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
      if (url.pathname.includes('/config/paths/get/')) return Response.json({ forward })
      if (url.pathname.includes('/config/paths/patch/')) {
        forward.splice(0, forward.length, ...((JSON.parse(String(init?.body)) as { forward: typeof forward }).forward))
        return Response.json({ status: 'ok' })
      }
      if (url.pathname.includes('/forward-dests/list')) return Response.json({ items: [{ pos: 2, state: 'forwarding', outboundBytes: 500 }] })
      throw new Error('Unexpected MediaMTX call')
    }) as typeof fetch
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'youtube', true)).toBe(true)
    expect(forward).toHaveLength(2)
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'youtube', true)).toBe(false)
    const snapshot = await destinationSnapshot('camara-a', 'session-abc')
    expect(snapshot.destinations[0]).toMatchObject({ enabled: true, state: 'forwarding', outboundBytes: 500 })
    expect(JSON.stringify(snapshot)).not.toContain('SEGREDO-123')
    expect(calls).toContain('PATCH /v3/config/paths/patch/session-abc')
    await expect(setDestinationEnabled('camara-a', 'session-abc', 'inexistente', true)).rejects.toMatchObject({ code: 'MEDIA_DESTINATION_NOT_FOUND' })
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'youtube', false)).toBe(true)
    expect(forward).toEqual([{ dest: 'rtmps://other.test/live#OUTRO' }])
  })

  test('dois destinos da mesma Câmara têm comandos independentes e idempotentes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'legis-two-destinations-'))
    const file = join(directory, 'destinations.json')
    const first = 'rtmps://example.test/a#SEGREDO-A'
    const second = 'rtmps://example.test/b#SEGREDO-B'
    await writeFile(file, JSON.stringify([
      { tenantId: 'camara-a', id: 'a', label: 'Destino A', platform: 'other', dest: first },
      { tenantId: 'camara-a', id: 'b', label: 'Destino B', platform: 'other', dest: second },
      { tenantId: 'camara-b', id: 'a', label: 'Outra Câmara', platform: 'other', dest: 'rtmps://example.test/other#OUTRO' },
    ]), { mode: 0o600 })
    process.env.MEDIA_DESTINATIONS_FILE = file
    process.env.MEDIA_CONTROL_URL = 'http://127.0.0.1:9997'
    const forward: Array<{ dest: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname
      if (pathname.includes('/config/paths/get/')) return Response.json({ forward, record: true })
      if (pathname.includes('/config/paths/patch/')) {
        forward.splice(0, forward.length, ...(JSON.parse(String(init?.body)) as { forward: typeof forward }).forward)
        return Response.json({ status: 'ok' })
      }
      if (pathname.includes('/forward-dests/list')) return Response.json({ items: forward.map((_, index) => ({ pos: index + 1, state: 'forwarding', outboundBytes: 1024 })) })
      throw new Error('Unexpected MediaMTX call')
    }) as typeof fetch
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'a', true)).toBe(true)
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'b', true)).toBe(true)
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'a', true)).toBe(false)
    expect(forward.map((entry) => entry.dest)).toEqual([first, second])
    const both = await destinationSnapshot('camara-a', 'session-abc')
    expect(both.destinations.map((entry) => entry.state)).toEqual(['forwarding', 'forwarding'])
    expect(JSON.stringify(both)).not.toContain('SEGREDO-')
    expect(await setDestinationEnabled('camara-a', 'session-abc', 'a', false)).toBe(true)
    expect(forward.map((entry) => entry.dest)).toEqual([second])
    expect((await destinationSnapshot('camara-a', 'session-abc')).destinations.map((entry) => entry.enabled)).toEqual([false, true])
    expect((await destinationSnapshot('camara-b', 'session-abc')).destinations[0]?.enabled).toBe(false)
  })

  test('bloqueia controlador fora de loopback', async () => {
    await setup()
    process.env.MEDIA_CONTROL_URL = 'http://internal.example.test:9997'
    await expect(destinationSnapshot('camara-a', 'session-abc')).rejects.toMatchObject({ code: 'MEDIA_CONTROL_UNAVAILABLE' })
  })

  test('mostra somente metadados do catálogo de gravações', async () => {
    await setup()
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path.includes('/config/paths/get/')) return Response.json({ forward: [], record: true })
      if (path.includes('/recordings/get/')) return Response.json({ name: 'session-abc', segments: [
        { start: '2026-10-10T10:00:00Z' }, { start: '2026-10-10T10:05:00Z' },
      ] })
      throw new Error('Unexpected call')
    }) as typeof fetch
    expect(await recordingSnapshot('session-abc')).toEqual({
      configured: true, segmentCount: 2, latestSegmentAt: '2026-10-10T10:05:00Z',
    })
  })
})
