import { afterAll, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import {
  caminhoDoBancoSqlite,
  ehTenantDescartavel,
  executarLimpeza,
  planejarLimpeza,
} from '../scripts/clean-test-tenants'

afterAll(async () => {
  await db.$disconnect()
})

const caminho = caminhoDoBancoSqlite(process.env.DATABASE_URL ?? '')

test('reconhece slug de tenant de teste e protege os três reais', () => {
  expect(ehTenantDescartavel('attendance-2c851078-abff-45d0-92e9-1db8b9e6555d')).toBe(true)
  expect(ehTenantDescartavel('self-attendance-57027519-a789-4f11-9972-d983247899e1')).toBe(true)
  expect(ehTenantDescartavel('scan-mail-a-062adc94-6bdb-4a7b-869d-e8bcc51518fe')).toBe(true)
  expect(ehTenantDescartavel('attendance-other-2c851078-abff-45d0-92e9-1db8b9e6555d')).toBe(true)
  expect(ehTenantDescartavel('camara-mucuri-ba')).toBe(false)
  expect(ehTenantDescartavel('camara-vila-nova')).toBe(false)
  expect(ehTenantDescartavel('camara-serra-azul')).toBe(false)
})

test('simulação não remove nada e aplicação apaga só o tenant de teste, em cascata', async () => {
  const sufixo = crypto.randomUUID()
  const descartavel = await db.tenant.create({
    data: { slug: `attendance-${sufixo}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA' },
  })
  const protegido = await db.tenant.create({
    data: { slug: 'camara-mucuri-ba', name: 'Mucuri', city: 'Mucuri', uf: 'BA' },
  })

  for (const tenant of [descartavel, protegido]) {
    const membro = await db.parliamentarian.create({
      data: { tenantId: tenant.id, name: 'Membro', party: 'SEM' },
    })
    await db.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Operador',
        email: `operador-${tenant.id}@example.invalid`,
        role: 'session_operator',
      },
    })
    const sessao = await db.session.create({
      data: {
        tenantId: tenant.id,
        number: 1,
        year: 2035,
        scheduledAt: new Date('2035-01-01T12:00:00.000Z'),
      },
    })
    const votacao = await db.voting.create({
      data: { sessionId: sessao.id, question: 'Aprova?', status: 'closed' },
    })
    await db.vote.create({
      data: {
        votingId: votacao.id,
        parliamentarianId: membro.id,
        value: 'sim',
        commandId: crypto.randomUUID(),
      },
    })
    await db.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actorName: 'Operador',
        actorRole: 'session_operator',
        action: 'voting.close',
        aggregateType: 'voting',
        aggregateId: votacao.id,
        summary: 'Encerrada',
        chainHash: 'hash',
      },
    })
  }

  const simulacao = planejarLimpeza(caminho)
  expect(simulacao.tenants.map((t) => t.slug)).toEqual([`attendance-${sufixo}`])
  expect(simulacao.linhasPorTabela.Vote).toBe(1)
  expect(simulacao.linhasPorTabela.Session).toBe(1)
  expect(await db.tenant.count()).toBe(2)

  const resultado = executarLimpeza(caminho)
  expect(resultado.tenants.map((t) => t.slug)).toEqual([`attendance-${sufixo}`])

  expect(await db.tenant.count()).toBe(1)
  expect((await db.tenant.findFirst())?.slug).toBe('camara-mucuri-ba')
  expect(await db.session.count()).toBe(1)
  expect(await db.voting.count()).toBe(1)
  expect(await db.vote.count()).toBe(1)
  expect(await db.parliamentarian.count()).toBe(1)
  expect(await db.user.count()).toBe(1)
  expect(await db.auditEvent.count()).toBe(1)
  expect(await db.session.count({ where: { tenantId: descartavel.id } })).toBe(0)
})
