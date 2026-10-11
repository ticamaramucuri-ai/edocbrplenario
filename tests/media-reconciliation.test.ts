import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '../src/lib/db'
import { reconcileMediaIntentsOnce } from '../src/lib/server/media-reconciliation'
import { beatMediaWorker, readMediaOperationsHealth } from '../src/lib/server/media-operations'

const originalFetch = globalThis.fetch
const originalFile = process.env.MEDIA_DESTINATIONS_FILE
const originalControl = process.env.MEDIA_CONTROL_URL
const originalMetrics = process.env.MEDIA_METRICS_URL
let directory: string | undefined

afterAll(async () => {
  globalThis.fetch = originalFetch
  if (originalFile === undefined) delete process.env.MEDIA_DESTINATIONS_FILE
  else process.env.MEDIA_DESTINATIONS_FILE = originalFile
  if (originalControl === undefined) delete process.env.MEDIA_CONTROL_URL
  else process.env.MEDIA_CONTROL_URL = originalControl
  if (originalMetrics === undefined) delete process.env.MEDIA_METRICS_URL
  else process.env.MEDIA_METRICS_URL = originalMetrics
  if (directory) await rm(directory, { recursive: true, force: true })
  await db.$disconnect()
})

describe('reconciliação durável de mídia', () => {
  test('uma instância aplica; reinício, erro e desativação são reconciliados sem segredos no banco', async () => {
    directory = await mkdtemp(join(tmpdir(), 'legis-media-reconcile-'))
    const secretFile = join(directory, 'destinations.json')
    const tenantId = `test-media-${crypto.randomUUID()}`
    const sessionId = `test-session-${crypto.randomUUID()}`
    const destination = 'rtmps://example.test/live#STREAM-KEY-SECRET'
    await writeFile(secretFile, JSON.stringify([{ tenantId, id: 'youtube', label: 'Canal de teste', platform: 'youtube', dest: destination }]), { mode: 0o600 })
    process.env.MEDIA_DESTINATIONS_FILE = secretFile
    process.env.MEDIA_CONTROL_URL = 'http://127.0.0.1:19997'
    process.env.MEDIA_METRICS_URL = 'http://127.0.0.1:19998/metrics'
    let forward: Array<{ dest: string }> = []
    let controlDown = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/metrics') return new Response(`paths{name="session-${sessionId}",state="ready"} 1\n`)
      if (controlDown) throw new Error('controller offline')
      if (url.pathname.includes('/config/paths/get/')) return Response.json({ forward })
      if (url.pathname.includes('/config/paths/patch/')) {
        forward = (JSON.parse(String(init?.body)) as { forward: Array<{ dest: string }> }).forward
        return Response.json({ status: 'ok' })
      }
      throw new Error('Unexpected MediaMTX call')
    }) as typeof fetch

    await db.tenant.create({ data: { id: tenantId, slug: tenantId, name: 'Teste mídia', city: 'Teste', uf: 'SP' } })
    await db.session.create({ data: { id: sessionId, tenantId, number: 1, year: 2026, scheduledAt: new Date() } })
    const transmission = await db.transmission.create({ data: { tenantId, sessionId, status: 'monitoring' } })
    const intent = await db.mediaDestinationIntent.create({
      data: { transmissionId: transmission.id, destinationId: 'youtube', desiredEnabled: true },
    })

    const parallel = await Promise.all([reconcileMediaIntentsOnce(), reconcileMediaIntentsOnce()])
    expect(parallel.reduce((sum, result) => sum + result.claimed, 0)).toBe(1)
    expect(forward).toEqual([{ dest: destination }])
    let row = await db.mediaDestinationIntent.findUniqueOrThrow({ where: { id: intent.id } })
    expect(row).toMatchObject({ syncStatus: 'applied', observedGeneration: 1, attempts: 0 })
    expect(JSON.stringify(row)).not.toContain('STREAM-KEY-SECRET')

    // Reinício do MediaMTX apaga o estado operacional; o próximo ciclo o recompõe.
    forward = []
    await db.mediaDestinationIntent.update({
      where: { id: intent.id },
      data: { nextAttemptAt: new Date(0), leaseOwner: 'worker-interrompido', leaseUntil: new Date(0) },
    })
    expect((await reconcileMediaIntentsOnce()).applied).toBe(1)
    expect(forward).toEqual([{ dest: destination }])

    controlDown = true
    await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { nextAttemptAt: new Date(0) } })
    expect((await reconcileMediaIntentsOnce()).failed).toBe(1)
    row = await db.mediaDestinationIntent.findUniqueOrThrow({ where: { id: intent.id } })
    expect(row).toMatchObject({ syncStatus: 'error', lastErrorCode: 'MEDIA_CONTROL_UNAVAILABLE', attempts: 1 })
    expect(await db.notification.count({ where: { tenantId, title: 'Falha no destino de mídia' } })).toBe(2)
    await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { nextAttemptAt: new Date(0) } })
    expect((await reconcileMediaIntentsOnce()).failed).toBe(1)
    expect(await db.notification.count({ where: { tenantId, title: 'Falha no destino de mídia' } })).toBe(2)

    controlDown = false
    await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { nextAttemptAt: new Date(0) } })
    expect((await reconcileMediaIntentsOnce()).applied).toBe(1)
    expect(await db.notification.count({ where: { tenantId, title: 'Destino de mídia normalizado' } })).toBe(2)
    await db.mediaDestinationIntent.update({
      where: { id: intent.id },
      data: { desiredEnabled: false, generation: { increment: 1 }, syncStatus: 'pending', nextAttemptAt: null },
    })
    expect((await reconcileMediaIntentsOnce()).applied).toBe(1)
    expect(forward).toEqual([])
    row = await db.mediaDestinationIntent.findUniqueOrThrow({ where: { id: intent.id } })
    expect(row).toMatchObject({ desiredEnabled: false, syncStatus: 'applied', observedGeneration: 2, attempts: 0 })
    expect(await db.notification.count({ where: { tenantId, title: 'Destino de mídia normalizado' } })).toBe(2)

    // Sinal de vida e backlog são verificáveis mesmo sem chamar o MediaMTX.
    let health = await readMediaOperationsHealth()
    expect(health).toMatchObject({ ok: false, worker: 'missing' })
    await beatMediaWorker('worker-teste', true)
    health = await readMediaOperationsHealth()
    expect(health).toMatchObject({ ok: true, worker: 'alive', pendingStale: 0, failedDestinations: 0 })
    const old = new Date(Date.now() - 120_000)
    await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { syncStatus: 'pending', updatedAt: old } })
    health = await readMediaOperationsHealth()
    expect(health).toMatchObject({ ok: false, pendingStale: 1 })
    expect(health.reasons).toContain('destination_pending_stale')
    await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { syncStatus: 'error', updatedAt: new Date() } })
    health = await readMediaOperationsHealth()
    expect(health).toMatchObject({ ok: false, failedDestinations: 1 })
    expect(health.reasons).toContain('destination_reconcile_error')
    await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { syncStatus: 'applied' } })
    health = await readMediaOperationsHealth(new Date(Date.now() + 31_000))
    expect(health).toMatchObject({ ok: false, worker: 'stale' })
    expect(health.reasons).toContain('worker_stale')
    expect(JSON.stringify(health)).not.toContain('STREAM-KEY-SECRET')
  })
})
