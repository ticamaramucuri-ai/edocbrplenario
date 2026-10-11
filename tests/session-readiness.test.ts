import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createSession } from '@/app/api/v1/sessions/route'
import { POST as transitionSession } from '@/app/api/v1/sessions/[id]/transition/route'
import { GET as readiness } from '@/app/api/v1/sessions/[id]/readiness/route'

const originalFetch = globalThis.fetch
const originalMetrics = process.env.MEDIA_METRICS_URL
const originalControl = process.env.MEDIA_CONTROL_URL
const originalDestinations = process.env.MEDIA_DESTINATIONS_FILE
let directory: string | null = null
afterAll(async () => {
  globalThis.fetch = originalFetch
  for (const [key, value] of [['MEDIA_METRICS_URL', originalMetrics], ['MEDIA_CONTROL_URL', originalControl], ['MEDIA_DESTINATIONS_FILE', originalDestinations]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (directory) await rm(directory, { recursive: true, force: true })
  await db.$disconnect()
})

test('prontidão separa deliberação e mídia, orienta o operador e isola Câmara', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `readiness-${suffix}`, name: 'Câmara Ensaio', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin', email: `admin-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const media = await db.user.create({ data: { tenantId: tenant.id, name: 'Mídia', email: `media-${suffix}@example.invalid`, role: 'media_operator' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Outro', email: `other-${suffix}@example.invalid`, role: 'media_operator' } })
  const president = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidência', party: 'SEM', boardRole: 'presidente' } })
  const matter = await db.legislativeMatter.create({ data: { tenantId: tenant.id, type: 'projeto_de_lei', number: 1, year: 2026, ementa: 'Ensaio', authors: '[]' } })
  const created = await createSession(new NextRequest('http://localhost/api/v1/sessions', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': admin.id },
    body: JSON.stringify({ type: 'ordinaria', scheduledAt: '2027-01-20T13:00:00.000Z', presidentId: president.id, matterIds: [matter.id] }),
  }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const id = (await created.json()).session.id as string
  const context = { params: Promise.resolve({ id }) }
  const query = (actorId: string) => readiness(new NextRequest(`http://localhost/api/v1/sessions/${id}/readiness`,
    { headers: { 'x-actor-id': actorId } }), context)
  expect((await query(outsider.id)).status).toBe(403)
  const draft = await (await query(media.id)).json()
  expect(draft.sessionReady).toBe(false)
  expect(draft.broadcastReady).toBe(false)
  expect(draft.checks.find((check: { id: string }) => check.id === 'agenda').state).toBe('blocked')
  const scheduled = await transitionSession(new NextRequest(`http://localhost/api/v1/sessions/${id}/transition`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': admin.id }, body: JSON.stringify({ action: 'schedule', version: 1 }),
  }), context)
  expect(scheduled.status).toBe(200)
  const published = await (await query(media.id)).json()
  expect(published.sessionReady).toBe(true)
  expect(published.broadcastReady).toBe(false)
  expect(published.checks.find((check: { id: string }) => check.id === 'notice').state).toBe('ok')

  directory = await mkdtemp(join(tmpdir(), 'edocbr-readiness-'))
  const file = join(directory, 'destinations.json')
  const secret = 'RTMPS-SECRET-DO-NOT-LEAK'
  await writeFile(file, JSON.stringify([{ tenantId: tenant.id, id: 'sink-a', label: 'Receptor local', platform: 'other', dest: `rtmps://127.0.0.1:19360/relay#${secret}` }]), { mode: 0o600 })
  process.env.MEDIA_DESTINATIONS_FILE = file
  process.env.MEDIA_METRICS_URL = 'http://127.0.0.1:9998/metrics'
  process.env.MEDIA_CONTROL_URL = 'http://127.0.0.1:9997'
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/metrics') return new Response(`paths{name="session-${id}",state="ready"} 1\n`)
    if (url.pathname.includes('/config/paths/get/')) return Response.json({ forward: [{ dest: `rtmps://127.0.0.1:19360/relay#${secret}` }], record: true })
    if (url.pathname.includes('/forward-dests/list')) return Response.json({ items: [{ pos: 1, state: 'forwarding', outboundBytes: 1024 }] })
    if (url.pathname.includes('/recordings/get/')) return Response.json({ segments: [{ start: new Date().toISOString() }] })
    throw new Error('Unexpected media request')
  }) as typeof fetch
  const readyResponse = await query(media.id)
  expect(readyResponse.status).toBe(200)
  const ready = await readyResponse.json()
  expect(ready.broadcastReady).toBe(true)
  expect(ready.checks.find((check: { id: string }) => check.id === 'destinations').state).toBe('ok')
  expect(JSON.stringify(ready)).not.toContain(secret)
})
