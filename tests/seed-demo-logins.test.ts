import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as login } from '@/app/api/v1/auth/login/route'

afterAll(async () => {
  await db.$disconnect()
})

const SENHA = 'DemoLegis!2026'

/** Os sete papéis oferecidos na entrada por perfil de demonstração. */
const PERFIS: Array<{ email: string; role: string }> = [
  { email: 'suporte@legissaas.dev', role: 'platform_owner' },
  { email: 'ana.ribeiro@vilanova.mg.leg.br', role: 'tenant_admin' },
  { email: 'paula.andrade@vilanova.mg.leg.br', role: 'legislative_admin' },
  { email: 'marcos.vieira@vilanova.mg.leg.br', role: 'session_operator' },
  { email: 'roberto.nogueira@vilanova.mg.leg.br', role: 'presiding_officer' },
  { email: 'carla.mendes@vilanova.mg.leg.br', role: 'parliamentarian' },
  { email: 'helena.costa@tce.mg.gov.br', role: 'auditor' },
]

function post(email: string, password: string) {
  return login(
    new NextRequest('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    { params: Promise.resolve({}) },
  )
}

test('os sete perfis de demonstração entram por senha com o papel esperado', async () => {
  const falhas: string[] = []
  for (const perfil of PERFIS) {
    const resposta = await post(perfil.email, SENHA)
    if (resposta.status !== 200) {
      falhas.push(`${perfil.email}: status ${resposta.status}`)
      continue
    }
    const corpo = await resposta.json()
    if (corpo.actor?.role !== perfil.role) {
      falhas.push(`${perfil.email}: papel ${corpo.actor?.role} ≠ ${perfil.role}`)
    }
  }
  expect(falhas).toEqual([])
})

test('todo usuário ativo de demonstração tem senha', async () => {
  const semSenha = await db.user.findMany({
    where: { active: true, passwordHash: null },
    select: { email: true },
  })
  expect(semSenha.map((u) => u.email)).toEqual([])
})

test('senha errada continua recusada', async () => {
  expect((await post('ana.ribeiro@vilanova.mg.leg.br', 'senha-errada-aqui')).status).toBe(401)
})
