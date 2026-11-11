import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createMatter } from '@/app/api/v1/matters/route'
import { POST as addProceeding } from '@/app/api/v1/matters/[id]/proceedings/route'
import { GET as matterDetail } from '@/app/api/v1/matters/[id]/route'
import { POST as createProtocol } from '@/app/api/v1/protocols/route'
import { PATCH as updateProtocol } from '@/app/api/v1/protocols/[id]/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, actorId: string, method = 'POST', body?: unknown) => new NextRequest(url, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const context = (id: string) => ({ params: Promise.resolve({ id }) })

test('matéria, tramitação append-only e protocolo mantêm sequência, estado e tenant', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `matter-${suffix}`, name: 'Câmara A', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `matter-out-${suffix}`, name: 'Câmara B', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Legislativo', email: `matter-${suffix}@example.invalid`, role: 'legislative_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Sessão', email: `matter-op-${suffix}@example.invalid`, role: 'session_operator' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Outro', email: `matter-out-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const foreignMatter = await db.legislativeMatter.create({ data: { tenantId: other.id, type: 'requerimento', number: 1, year: 2026, ementa: 'Matéria de outra Câmara', authors: '[]' } })

  const create = (actorId: string, body: unknown) => createMatter(request('http://localhost/api/v1/matters', actorId, 'POST', body), { params: Promise.resolve({}) })
  expect((await create(operator.id, { type: 'projeto_de_lei', ementa: 'Projeto sem permissão de escrita', authors: ['Ana'] })).status).toBe(403)
  expect((await create(admin.id, { type: 'projeto_de_lei', ementa: 'Curta', authors: ['Ana'] })).status).toBe(422)
  const payload = { type: 'projeto_de_lei', ementa: 'Institui política pública municipal de leitura', authors: ['Ana Silva'], regime: 'urgencia', year: 2026 }
  const firstResponse = await create(admin.id, payload)
  expect(firstResponse.status).toBe(201)
  const first = (await firstResponse.json()).matter
  expect(first).toMatchObject({ number: 1, year: 2026, status: 'em_tramitacao', regime: 'urgencia', authors: ['Ana Silva'] })
  const secondResponse = await create(admin.id, { ...payload, ementa: 'Institui política municipal de incentivo ao esporte' })
  const second = (await secondResponse.json()).matter
  expect(second.number).toBe(2)

  const proceedings = (actorId: string, id: string, body: unknown) => addProceeding(
    request(`http://localhost/api/v1/matters/${id}/proceedings`, actorId, 'POST', body), context(id))
  const invalidSeq = await proceedings(admin.id, first.id, { action: 'despacho', toStatus: 'em_tramitacao', seq: 2, notes: 'Distribuição inicial.' })
  expect(invalidSeq.status).toBe(409)
  expect((await proceedings(operator.id, first.id, { action: 'despacho', toStatus: 'em_tramitacao' })).status).toBe(403)
  expect((await proceedings(outsider.id, first.id, { action: 'despacho', toStatus: 'em_tramitacao' })).status).toBe(403)
  expect((await proceedings(admin.id, first.id, { action: 'inclusao_pauta', toStatus: 'incluida_pauta', seq: 1, notes: 'Parecer favorável.' })).status).toBe(201)
  expect((await proceedings(admin.id, first.id, { action: 'sessao', toStatus: 'aprovado', seq: 2 })).status).toBe(201)
  expect((await proceedings(admin.id, first.id, { action: 'outro', toStatus: 'em_tramitacao', seq: 3 })).status).toBe(409)
  const detail = await matterDetail(request(`http://localhost/api/v1/matters/${first.id}`, admin.id, 'GET'), context(first.id))
  expect(detail.status).toBe(200)
  expect((await detail.json()).proceedings.map((item: { seq: number }) => item.seq)).toEqual([1, 2])
  expect(await db.legislativeMatter.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'aprovado' })

  const createEntry = (actorId: string, body: unknown) => createProtocol(request('http://localhost/api/v1/protocols', actorId, 'POST', body), { params: Promise.resolve({}) })
  const protocolPayload = { kind: 'materia', senderName: 'Gabinete Parlamentar', subject: 'Protocolo de projeto de lei', year: 2026 }
  expect((await createEntry(operator.id, protocolPayload)).status).toBe(403)
  expect((await createEntry(admin.id, { ...protocolPayload, matterId: foreignMatter.id })).status).toBe(403)
  const protocol1Response = await createEntry(admin.id, protocolPayload)
  expect(protocol1Response.status).toBe(201)
  const protocol1 = (await protocol1Response.json()).protocol
  const protocol2 = (await (await createEntry(admin.id, { ...protocolPayload, subject: 'Protocolo de requerimento' })).json()).protocol
  expect([protocol1.number, protocol2.number]).toEqual([1, 2])

  const update = (action: string, extra: object = {}) => updateProtocol(
    request(`http://localhost/api/v1/protocols/${protocol1.id}`, admin.id, 'PATCH', { action, ...extra }), context(protocol1.id))
  expect((await update('anular')).status).toBe(422)
  expect((await update('distribuir', { matterId: foreignMatter.id })).status).toBe(403)
  expect((await update('distribuir', { matterId: first.id })).status).toBe(200)
  expect((await update('arquivar')).status).toBe(200)
  expect((await update('anular', { justification: 'Registro duplicado confirmado no livro.' })).status).toBe(200)
  expect((await update('arquivar')).status).toBe(409)
  expect(await db.auditEvent.count({ where: { aggregateId: protocol1.id, action: { startsWith: 'protocol.' } } })).toBe(4)
})
