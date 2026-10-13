import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as commandGet, POST as commandPost } from '@/app/api/v1/display/command/route'
import { GET as publicLiveGet } from '@/app/api/v1/public/live/route'
import { GET as publicFrameGet } from '@/app/api/v1/public/display-frame/route'

afterAll(async () => { await db.$disconnect() })

test('comandos persistem por sessão com versão crescente e leitura pública isolada por Câmara', async () => {
  const suffix = crypto.randomUUID()
  const tenantA = await db.tenant.create({ data: { slug: `display-a-${suffix}`, name: 'Câmara A', city: 'A', uf: 'BA' } })
  const tenantB = await db.tenant.create({ data: { slug: `display-b-${suffix}`, name: 'Câmara B', city: 'B', uf: 'BA' } })
  const operator = await db.user.create({ data: { tenantId: tenantA.id, name: 'Operador', email: `display-${suffix}@example.invalid`, role: 'session_operator' } })
  const sessionA = await db.session.create({ data: { tenantId: tenantA.id, number: 1, year: 2037, scheduledAt: new Date('2037-01-01T12:00:00Z'), status: 'open' } })
  const otherSessionA = await db.session.create({ data: { tenantId: tenantA.id, number: 2, year: 2037, scheduledAt: new Date('2037-02-01T12:00:00Z'), status: 'scheduled' } })
  const sessionB = await db.session.create({ data: { tenantId: tenantB.id, number: 1, year: 2037, scheduledAt: new Date('2037-01-01T12:00:00Z'), status: 'open' } })
  const context = { params: Promise.resolve({}) }
  const command = async (sessionId: string, action: string, profile?: string) => commandPost(new NextRequest('http://localhost/api/v1/display/command', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': operator.id },
    body: JSON.stringify({ sessionId, action, profile }),
  }), context)
  const publicState = async (slug: string) => {
    const response = await publicLiveGet(new NextRequest(`http://localhost/api/v1/public/live?tenant=${slug}`), context)
    expect(response.status).toBe(200)
    return (await response.json()).displayState
  }

  expect((await command(sessionB.id, 'clear')).status).toBe(403)
  expect((await command(otherSessionA.id, 'freeze')).status).toBe(422)
  expect(await publicState(tenantB.slug)).toBeNull()
  expect((await command(sessionA.id, 'freeze')).status).toBe(200)
  const frozenState = await publicState(tenantA.slug)
  expect(frozenState).toMatchObject({ sessionId: sessionA.id, version: 1, mode: 'frozen', manualProfile: null })
  expect(frozenState.frozenFrameSha256).toMatch(/^[0-9a-f]{64}$/)
  const frameUrl = (slug: string, version: number) => `http://localhost/api/v1/public/display-frame?tenant=${slug}&sessionId=${sessionA.id}&version=${version}`
  const frozenFrame = await publicFrameGet(new NextRequest(frameUrl(tenantA.slug, 1)), context)
  expect(frozenFrame.status).toBe(200)
  const captured = await frozenFrame.json()
  expect(captured.sha256).toBe(frozenState.frozenFrameSha256)
  expect(captured.frame.session.presidentName).toBeNull()
  await db.session.update({ where: { id: sessionA.id }, data: { presidentName: 'Presidente alterado' } })
  const currentLive = await publicLiveGet(new NextRequest(`http://localhost/api/v1/public/live?tenant=${tenantA.slug}`), context)
  expect((await currentLive.json()).session.presidentName).toBe('Presidente alterado')
  const sameFrame = await publicFrameGet(new NextRequest(frameUrl(tenantA.slug, 1)), context)
  expect((await sameFrame.json()).frame.session.presidentName).toBeNull()
  expect((await publicFrameGet(new NextRequest(frameUrl(tenantB.slug, 1)), context)).status).toBe(404)
  const originalJson = (await db.displayState.findUniqueOrThrow({ where: { sessionId: sessionA.id } })).frozenFrameJson
  await db.displayState.update({ where: { sessionId: sessionA.id }, data: { frozenFrameJson: '{}' } })
  expect((await publicFrameGet(new NextRequest(frameUrl(tenantA.slug, 1)), context)).status).toBe(404)
  await db.displayState.update({ where: { sessionId: sessionA.id }, data: { frozenFrameJson: originalJson } })
  const internal = await commandGet(new NextRequest(`http://localhost/api/v1/display/command?sessionId=${sessionA.id}`, { headers: { 'x-actor-id': operator.id } }), context)
  expect(internal.status).toBe(200)
  expect((await internal.json()).state.version).toBe(1)
  expect((await commandGet(new NextRequest(`http://localhost/api/v1/display/command?sessionId=${sessionB.id}`, { headers: { 'x-actor-id': operator.id } }), context)).status).toBe(403)
  expect((await command(sessionA.id, 'profile', 'votacao')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 2, mode: 'live', manualProfile: 'votacao', frozenFrameSha256: null })
  expect((await publicFrameGet(new NextRequest(frameUrl(tenantA.slug, 1)), context)).status).toBe(404)
  expect((await command(sessionA.id, 'clear')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 3, mode: 'cleared', manualProfile: 'boas_vindas', frozenFrameSha256: null })
  expect((await command(sessionA.id, 'unfreeze')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 4, mode: 'live', manualProfile: 'boas_vindas', frozenFrameSha256: null })
  expect(await db.outboxEvent.count({ where: { tenantId: tenantA.id, eventType: 'display.command' } })).toBe(4)
  expect(await publicState(tenantB.slug)).toBeNull()
})
