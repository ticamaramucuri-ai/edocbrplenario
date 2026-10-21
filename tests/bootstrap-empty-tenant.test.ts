import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as bootstrap } from '@/app/api/v1/bootstrap/route'

afterAll(async () => {
  await db.$disconnect()
})

function get(slug: string) {
  return bootstrap(
    new NextRequest(`http://localhost/api/v1/bootstrap?tenant=${slug}`),
    { params: Promise.resolve({}) },
  )
}

test('tenant sem usuários responde 200 e explica a lista vazia', async () => {
  const sufixo = crypto.randomUUID()
  await db.tenant.create({
    data: { slug: `vazio-${sufixo}`, name: 'Câmara Sem Usuários', city: 'Teste', uf: 'BA' },
  })

  const resposta = await get(`vazio-${sufixo}`)
  expect(resposta.status).toBe(200)
  const corpo = await resposta.json()
  expect(corpo.actors).toEqual([])
  expect(corpo.actorsEmptyReason).toBe('tenant_sem_usuarios')
})

test('tenant com usuário não traz motivo', async () => {
  const sufixo = crypto.randomUUID()
  const tenant = await db.tenant.create({
    data: { slug: `povoado-${sufixo}`, name: 'Câmara Com Usuário', city: 'Teste', uf: 'BA' },
  })
  await db.user.create({
    data: {
      tenantId: tenant.id,
      name: 'Operadora',
      email: `operadora-${sufixo}@example.invalid`,
      role: 'session_operator',
    },
  })

  const corpo = await (await get(`povoado-${sufixo}`)).json()
  expect(corpo.actors.length).toBe(1)
  expect(corpo.actorsEmptyReason).toBeNull()
})

test('ator de plataforma na lista não apaga o motivo do tenant vazio', async () => {
  const sufixo = crypto.randomUUID()
  await db.tenant.create({
    data: { slug: `plataforma-${sufixo}`, name: 'Câmara Sem Usuários', city: 'Teste', uf: 'BA' },
  })
  await db.user.create({
    data: {
      tenantId: null,
      name: 'Suporte',
      email: `suporte-${sufixo}@example.invalid`,
      role: 'platform_owner',
    },
  })

  const corpo = await (await get(`plataforma-${sufixo}`)).json()
  expect(corpo.actors.map((a: { role: string }) => a.role)).toEqual(['platform_owner'])
  expect(corpo.actorsEmptyReason).toBe('tenant_sem_usuarios')
})
