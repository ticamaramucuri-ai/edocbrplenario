import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createLegislature } from '@/app/api/v1/legislatures/route'
import { GET as listBoard, POST as createBoardPosition } from '@/app/api/v1/board/route'
import { PATCH as patchBoardPosition } from '@/app/api/v1/board/[id]/route'
import { civilDayStartUtc, civilDayEndUtc } from '@/lib/civil-time'

afterAll(async () => { await db.$disconnect() })

test('legislatura sem ordinal e Mesa futura permanecem distintas da composição vigente', async () => {
  const slug = `periodo-${crypto.randomUUID()}`
  const tenant = await db.tenant.create({ data: { slug, name: 'Câmara Teste', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin',
    email: `${slug}@example.invalid`, role: 'tenant_admin' } })
  const current = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente atual', party: 'ABC' } })
  const elected = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Presidente eleita', party: 'ABC' } })
  const headers = { 'content-type': 'application/json', 'x-actor-id': admin.id }
  const context = { params: Promise.resolve({}) }
  const request = (path: string, body: object) => new NextRequest(`http://localhost/api/v1/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const created = await createLegislature(request('legislatures', {
    number: null, startYear: 2025, endYear: 2028, current: true,
  }), context)
  expect(created.status).toBe(201)
  const legislature = (await created.json()).legislature
  expect(legislature.number).toBeNull()
  const first = await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'presidente', parliamentarianId: current.id,
    startDate: '2025-01-01T03:00:00.000Z', endDate: '2027-01-01T02:59:59.999Z',
  }), context)
  expect(first.status).toBe(201)
  const conflict = await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'presidente', parliamentarianId: elected.id,
    startDate: '2026-12-31T03:00:00.000Z',
  }), context)
  expect(conflict.status).toBe(422)
  const future = await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'presidente', parliamentarianId: elected.id,
    startDate: '2027-01-01T03:00:00.000Z', endDate: '2029-01-01T02:59:59.999Z',
    status: 'elected', electionReference: 'Ata de eleição de ensaio',
  }), context)
  expect(future.status).toBe(201)
  const futureId = (await future.json()).position.id
  const premature = await patchBoardPosition(new NextRequest(`http://localhost/api/v1/board/${futureId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ action: 'confirmar_posse', confirmationReference: 'Ata de posse 2027' }),
  }), { params: Promise.resolve({ id: futureId }) })
  expect(premature.status).toBe(422)
  const response = await listBoard(new NextRequest('http://localhost/api/v1/board', { headers }), context)
  const board = (await response.json()).board
  expect(board).toHaveLength(2)
  expect(board.find((item: { parliamentarianId: string }) => item.parliamentarianId === current.id).current).toBe(true)
  expect(board.find((item: { parliamentarianId: string }) => item.parliamentarianId === elected.id).current).toBe(false)
  expect(board.find((item: { parliamentarianId: string }) => item.parliamentarianId === elected.id).status).toBe('elected')
  const cancelled = await patchBoardPosition(new NextRequest(`http://localhost/api/v1/board/${futureId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ action: 'cancelar_eleicao', confirmationReference: 'Ato de cancelamento de ensaio' }),
  }), { params: Promise.resolve({ id: futureId }) })
  expect(cancelled.status).toBe(200)
  expect((await cancelled.json()).position.status).toBe('cancelled')
  const replacement = await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'presidente', parliamentarianId: elected.id,
    startDate: '2027-01-01T03:00:00.000Z', status: 'elected', electionReference: 'Ata de eleição de ensaio',
  }), context)
  expect(replacement.status).toBe(201)

  const vice = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vice eleita', party: 'ABC' } })
  const pastElection = await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'vice_presidente', parliamentarianId: vice.id,
    startDate: '2025-01-01T03:00:00.000Z', status: 'elected', electionReference: 'Ata de eleição de ensaio',
  }), context)
  expect(pastElection.status).toBe(201)
  const viceId = (await pastElection.json()).position.id
  const confirmed = await patchBoardPosition(new NextRequest(`http://localhost/api/v1/board/${viceId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ action: 'confirmar_posse', confirmationReference: 'Ata de posse de ensaio 1/2025' }),
  }), { params: Promise.resolve({ id: viceId }) })
  expect(confirmed.status).toBe(200)
  expect((await confirmed.json()).position.current).toBe(true)
  expect((await db.parliamentarian.findUniqueOrThrow({ where: { id: vice.id } })).boardRole).toBe('vice_presidente')

  const secretary = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Secretária atual', party: 'ABC' } })
  const successor = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Secretária eleita', party: 'ABC' } })
  expect((await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'primeiro_secretario', parliamentarianId: secretary.id,
    startDate: '2025-01-01T03:00:00.000Z',
  }), context)).status).toBe(201)
  expect((await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'primeiro_secretario', parliamentarianId: successor.id,
    startDate: '2027-01-01T03:00:00.000Z', status: 'elected', electionReference: 'Ata de eleição de ensaio',
  }), context)).status).toBe(201)
  expect((await createBoardPosition(request('board', {
    legislatureId: legislature.id, role: 'segundo_secretario', parliamentarianId: successor.id,
    status: 'elected', electionReference: 'Ata de eleição de ensaio',
  }), context)).status).toBe(422)
  expect(await db.auditEvent.count({ where: { tenantId: tenant.id, action: 'board.designated',
    justification: 'Ata de eleição de ensaio' } })).toBeGreaterThan(0)
})

test('data civil usa o fuso da Câmara ao registrar posse', () => {
  expect(civilDayStartUtc('2027-01-01', 'America/Bahia')).toBe('2027-01-01T03:00:00.000Z')
  expect(civilDayStartUtc('2027-01-01', 'America/Manaus')).toBe('2027-01-01T04:00:00.000Z')
  expect(civilDayEndUtc('2028-12-31', 'America/Bahia')).toBe('2029-01-01T02:59:59.999Z')
  expect(() => civilDayStartUtc('2027-02-30', 'America/Bahia')).toThrow()
})
