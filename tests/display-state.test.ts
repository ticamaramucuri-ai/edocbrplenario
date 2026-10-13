import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as commandGet, POST as commandPost } from '@/app/api/v1/display/command/route'
import { GET as publicLiveGet } from '@/app/api/v1/public/live/route'

afterAll(async () => { await db.$disconnect() })

test('comandos persistem por sessão com versão crescente e leitura pública isolada por Câmara', async () => {
  const suffix = crypto.randomUUID()
  const tenantA = await db.tenant.create({ data: { slug: `display-a-${suffix}`, name: 'Câmara A', city: 'A', uf: 'BA' } })
  const tenantB = await db.tenant.create({ data: { slug: `display-b-${suffix}`, name: 'Câmara B', city: 'B', uf: 'BA' } })
  const operator = await db.user.create({ data: { tenantId: tenantA.id, name: 'Operador', email: `display-${suffix}@example.invalid`, role: 'session_operator' } })
  const sessionA = await db.session.create({ data: { tenantId: tenantA.id, number: 1, year: 2037, scheduledAt: new Date('2037-01-01T12:00:00Z'), status: 'open' } })
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
  expect(await publicState(tenantB.slug)).toBeNull()
  expect((await command(sessionA.id, 'freeze')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 1, mode: 'frozen', manualProfile: null })
  const internal = await commandGet(new NextRequest(`http://localhost/api/v1/display/command?sessionId=${sessionA.id}`, { headers: { 'x-actor-id': operator.id } }), context)
  expect(internal.status).toBe(200)
  expect((await internal.json()).state.version).toBe(1)
  expect((await commandGet(new NextRequest(`http://localhost/api/v1/display/command?sessionId=${sessionB.id}`, { headers: { 'x-actor-id': operator.id } }), context)).status).toBe(403)
  expect((await command(sessionA.id, 'profile', 'votacao')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 2, mode: 'live', manualProfile: 'votacao' })
  expect((await command(sessionA.id, 'clear')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 3, mode: 'cleared', manualProfile: 'boas_vindas' })
  expect((await command(sessionA.id, 'unfreeze')).status).toBe(200)
  expect(await publicState(tenantA.slug)).toEqual({ sessionId: sessionA.id, version: 4, mode: 'live', manualProfile: 'boas_vindas' })
  expect(await db.outboxEvent.count({ where: { tenantId: tenantA.id, eventType: 'display.command' } })).toBe(4)
  expect(await publicState(tenantB.slug)).toBeNull()
})
