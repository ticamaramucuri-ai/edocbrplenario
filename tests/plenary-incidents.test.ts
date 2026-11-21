import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PATCH as patchAgendaItem } from '@/app/api/v1/agenda-items/[itemId]/route'
import { POST as transitionSpeech } from '@/app/api/v1/speeches/[id]/transition/route'

afterAll(async () => {
  await db.$disconnect()
})

const patch = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

const post = (url: string, actorId: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
    body: JSON.stringify(body),
  })

test('incidentes regimentais (vista, destaque, inversao) e cancelamento de discurso funcionam com auditoria', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `f2-${suffix}`, name: 'Câmara F2', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({
    data: { tenantId: tenant.id, name: 'Operador', email: `op-${suffix}@example.invalid`, role: 'session_operator' },
  })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Ver. Teste', party: 'SEM' } })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2040,
      scheduledAt: new Date('2040-01-01T12:00:00.000Z'),
      status: 'open',
      official: true,
    },
  })

  const item1 = await db.agendaItem.create({
    data: { sessionId: session.id, section: 'ordem_dia', order: 0, title: 'Projeto de Lei 01', status: 'pendente' },
  })
  const item2 = await db.agendaItem.create({
    data: { sessionId: session.id, section: 'ordem_dia', order: 1, title: 'Projeto de Lei 02', status: 'pendente' },
  })

  // Destaque exige justificativa
  const badDestaque = await patchAgendaItem(
    patch(`http://localhost/api/v1/agenda-items/${item1.id}`, operator.id, { action: 'destaque', justification: 'abc' }),
    { params: Promise.resolve({ itemId: item1.id }) }
  )
  expect(badDestaque.status).toBe(422)

  // Destaque válido mantém item e grava auditoria
  const destaqueRes = await patchAgendaItem(
    patch(`http://localhost/api/v1/agenda-items/${item1.id}`, operator.id, {
      action: 'destaque',
      justification: 'Destaque para votação em separado do artigo 2º.',
    }),
    { params: Promise.resolve({ itemId: item1.id }) }
  )
  expect(destaqueRes.status).toBe(200)

  // Inversão de ordem durante sessão aberta
  const invRes = await patchAgendaItem(
    patch(`http://localhost/api/v1/agenda-items/${item2.id}`, operator.id, {
      action: 'inversao',
      order: 0,
      justification: 'Inversão aprovada pelo plenário para prioridade.',
    }),
    { params: Promise.resolve({ itemId: item2.id }) }
  )
  expect(invRes.status).toBe(200)
  const invBody = await invRes.json()
  expect(invBody.agenda[0].id).toBe(item2.id)

  // Pedido de vista altera para adiado e audita
  const vistaRes = await patchAgendaItem(
    patch(`http://localhost/api/v1/agenda-items/${item1.id}`, operator.id, {
      action: 'vista',
      justification: 'Pedido de vista concedido pelo prazo regimental.',
    }),
    { params: Promise.resolve({ itemId: item1.id }) }
  )
  expect(vistaRes.status).toBe(200)
  const updatedItem1 = await db.agendaItem.findUniqueOrThrow({ where: { id: item1.id } })
  expect(updatedItem1.status).toBe('adiado')

  // Cancelamento de discurso na fila
  const speech = await db.speech.create({
    data: {
      sessionId: session.id,
      parliamentarianId: member.id,
      kind: 'grande_expediente',
      plannedSeconds: 300,
      status: 'fila',
    },
  })
  const cancelRes = await transitionSpeech(
    post(`http://localhost/api/v1/speeches/${speech.id}/transition`, operator.id, { action: 'cancel' }),
    { params: Promise.resolve({ id: speech.id }) }
  )
  expect(cancelRes.status).toBe(200)
  const updatedSpeech = await db.speech.findUniqueOrThrow({ where: { id: speech.id } })
  expect(updatedSpeech.status).toBe('cancelado')

  // Não pode cancelar discurso já cancelado
  const cancelAgain = await transitionSpeech(
    post(`http://localhost/api/v1/speeches/${speech.id}/transition`, operator.id, { action: 'cancel' }),
    { params: Promise.resolve({ id: speech.id }) }
  )
  expect(cancelAgain.status).toBe(409)
})
