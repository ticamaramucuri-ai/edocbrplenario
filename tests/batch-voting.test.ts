import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createVoting } from '@/app/api/v1/sessions/[id]/votings/route'

afterAll(async () => {
  await db.$disconnect()
})

test('votação em bloco agrupa múltiplos itens da pauta e marca todos como em_votacao', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `bloco-${suffix}`, name: 'Câmara Bloco', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({
    data: { tenantId: tenant.id, name: 'Operador', email: `op-${suffix}@example.invalid`, role: 'session_operator' },
  })
  const session = await db.session.create({
    data: {
      tenantId: tenant.id,
      number: 1,
      year: 2043,
      scheduledAt: new Date('2043-01-01T12:00:00.000Z'),
      status: 'open',
      official: true,
    },
  })
  const i1 = await db.agendaItem.create({
    data: { sessionId: session.id, section: 'ordem_dia', order: 0, title: 'Requerimento 01/2043', status: 'pendente' },
  })
  const i2 = await db.agendaItem.create({
    data: { sessionId: session.id, section: 'ordem_dia', order: 1, title: 'Requerimento 02/2043', status: 'pendente' },
  })

  const res = await createVoting(
    new NextRequest(`http://localhost/api/v1/sessions/${session.id}/votings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': operator.id },
      body: JSON.stringify({
        agendaItemIds: [i1.id, i2.id],
        mode: 'simbolico',
        rule: 'maioria_simples',
      }),
    }),
    { params: Promise.resolve({ id: session.id }) }
  )
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.voting.question).toContain('Votação em bloco (2 itens)')

  const updated = await db.agendaItem.findMany({ where: { id: { in: [i1.id, i2.id] } } })
  expect(updated.every((it) => it.status === 'em_votacao')).toBe(true)
})
