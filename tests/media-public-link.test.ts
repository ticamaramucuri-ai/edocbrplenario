import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { POST as publicLinkPost } from '@/app/api/v1/sessions/[id]/transmission/public-link/route'
import { GET as publicLiveGet } from '@/app/api/v1/public/live/route'
import { GET as publicSessionGet } from '@/app/api/v1/public/sessions/[id]/route'
import { validPublicWatchUrl, loadMediaDestinations } from '@/lib/server/media-control'

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

test('URL de exibição pública exige HTTPS e host público', () => {
  expect(validPublicWatchUrl('https://www.youtube.com/watch?v=abc123')).toBe(true)
  for (const url of ['http://example.org/live', 'https://localhost/live', 'https://127.0.0.1/live', 'https://x.local/live', 'https://user:password@example.org/live', 'rtmps://example.org/live#key']) {
    expect(validPublicWatchUrl(url)).toBe(false)
  }
})

test('publicação exige conferência e transporte pronto; portal só mostra link confirmado da Câmara', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `live-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA' } })
  const another = await db.tenant.create({ data: { slug: `other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `operator-${suffix}@example.invalid`, role: 'media_operator' } })
  const otherOperator = await db.user.create({ data: { tenantId: another.id, name: 'Outro', email: `other-${suffix}@example.invalid`, role: 'media_operator' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026, status: 'open', scheduledAt: new Date() } })
  const secret = 'rtmps://example.test/live#STREAM-KEY-SECRET'
  const publicUrl = 'https://www.youtube.com/watch?v=abc123'
  directory = await mkdtemp(join(tmpdir(), 'media-public-link-'))
  const file = join(directory, 'destinations.json')
  await writeFile(file, JSON.stringify([{ tenantId: tenant.id, id: 'youtube', label: 'Canal oficial', platform: 'youtube', dest: secret, publicUrl }]), { mode: 0o600 })
  process.env.MEDIA_DESTINATIONS_FILE = file
  process.env.MEDIA_CONTROL_URL = 'http://127.0.0.1:9997'
  process.env.MEDIA_METRICS_URL = 'http://127.0.0.1:9998/metrics'
  expect((await loadMediaDestinations(another.id))).toHaveLength(0)
  let ready = true
  let forwarding = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (path === '/metrics') return new Response(`paths{name="session-${session.id}",state="ready"} ${ready ? 1 : 0}\n`)
    if (path.includes('/config/paths/get/')) return Response.json({ forward: [{ dest: secret }] })
    if (path.includes('/forward-dests/list')) return Response.json({ items: [{ pos: 1, state: forwarding ? 'forwarding' : 'idle', outboundBytes: 500 }] })
    throw new Error(`Unexpected ${path}`)
  }) as typeof fetch
  const transmission = await db.transmission.create({ data: { tenantId: tenant.id, sessionId: session.id, status: 'monitoring' } })
  const intent = await db.mediaDestinationIntent.create({ data: { transmissionId: transmission.id, destinationId: 'youtube', desiredEnabled: true, syncStatus: 'pending' } })
  const command = (actorId: string, action: 'publish' | 'withdraw', version: number, key: string, confirmed = true) => publicLinkPost(
    new NextRequest(`http://localhost/api/v1/sessions/${session.id}/transmission/public-link`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
      body: JSON.stringify({ action, version, idempotencyKey: key, destinationId: 'youtube', platformConfirmed: confirmed }),
    }), { params: Promise.resolve({ id: session.id }) },
  )
  const live = () => publicLiveGet(new NextRequest(`http://localhost/api/v1/public/live?tenant=${tenant.slug}`), { params: Promise.resolve({}) })

  expect((await command(otherOperator.id, 'publish', 1, crypto.randomUUID())).status).toBe(403)
  expect((await command(operator.id, 'publish', 1, crypto.randomUUID(), false)).status).toBe(409)
  expect((await command(operator.id, 'publish', 1, crypto.randomUUID())).status).toBe(409)
  await db.mediaDestinationIntent.update({ where: { id: intent.id }, data: { syncStatus: 'applied' } })
  forwarding = false
  expect((await command(operator.id, 'publish', 1, crypto.randomUUID())).status).toBe(409)
  forwarding = true
  ready = false
  expect((await command(operator.id, 'publish', 1, crypto.randomUUID())).status).toBe(409)
  ready = true
  const key = crypto.randomUUID()
  const published = await command(operator.id, 'publish', 1, key)
  expect(published.status).toBe(200)
  expect((await published.json()).transmission.publicLink.url).toBe(publicUrl)
  expect((await command(operator.id, 'publish', 1, key)).status).toBe(200)
  expect((await db.transmission.findUniqueOrThrow({ where: { id: transmission.id } })).version).toBe(2)
  expect((await (await live()).json()).transmissionLink.url).toBe(publicUrl)
  const historical = await publicSessionGet(new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), { params: Promise.resolve({ id: session.id }) })
  expect((await historical.json()).transmissionLink.url).toBe(publicUrl)
  const audit = await db.auditEvent.findFirstOrThrow({ where: { aggregateId: transmission.id, action: 'transmission.public_link.publish' } })
  expect(JSON.stringify(audit)).not.toContain('STREAM-KEY-SECRET')
  const withdrawn = await command(operator.id, 'withdraw', 2, crypto.randomUUID())
  expect(withdrawn.status).toBe(200)
  expect((await (await live()).json()).transmissionLink).toBeNull()
  const withdrawnDetail = await publicSessionGet(new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), { params: Promise.resolve({ id: session.id }) })
  expect((await withdrawnDetail.json()).transmissionLink).toBeNull()
})
