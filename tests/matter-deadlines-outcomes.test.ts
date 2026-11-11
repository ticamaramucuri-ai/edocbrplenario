import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createMatter } from '@/app/api/v1/matters/route'
import { POST as addProceeding } from '@/app/api/v1/matters/[id]/proceedings/route'
import { POST as addVersion } from '@/app/api/v1/matters/[id]/versions/route'
import { POST as addOutcome } from '@/app/api/v1/matters/[id]/outcomes/route'
import { GET as listTasks, POST as createTask } from '@/app/api/v1/tasks/route'
import { PATCH as updateTask } from '@/app/api/v1/tasks/[id]/route'

afterAll(async () => { await db.$disconnect() })

const request = (url: string, actorId: string, method = 'POST', body?: unknown) => new NextRequest(url, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-actor-id': actorId },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const context = (id: string) => ({ params: Promise.resolve({ id }) })

test('versões, prazos, veto parcial e sanção preservam vínculos e trilha', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `outcome-${suffix}`, name: 'Câmara', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `outcome-out-${suffix}`, name: 'Outra', city: 'Teste', uf: 'BA' } })
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Legislativo', email: `outcome-${suffix}@example.invalid`, role: 'legislative_admin' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `outcome-op-${suffix}@example.invalid`, role: 'session_operator' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Outra Câmara', email: `outcome-out-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const created = await createMatter(request('http://localhost/api/v1/matters', admin.id, 'POST', {
    type: 'projeto_de_lei', ementa: 'Cria política municipal de proteção ambiental', authors: ['João Silva'], year: 2026,
  }), { params: Promise.resolve({}) })
  expect(created.status).toBe(201)
  const matter = (await created.json()).matter
  const versionEndpoint = `http://localhost/api/v1/matters/${matter.id}/versions`
  const version = (actorId: string, text: string) => addVersion(request(versionEndpoint, actorId, 'POST', { text }), context(matter.id))
  expect((await version(operator.id, 'Texto integral inicial do projeto.')).status).toBe(403)
  expect((await version(admin.id, 'curto')).status).toBe(422)
  expect((await version(admin.id, 'Texto integral inicial do projeto.')).status).toBe(201)
  expect((await version(admin.id, 'Texto integral revisado após parecer.')).status).toBe(201)

  const proceeding = (action: string, toStatus: string) => addProceeding(
    request(`http://localhost/api/v1/matters/${matter.id}/proceedings`, admin.id, 'POST', { action, toStatus }), context(matter.id))
  expect((await proceeding('inclusao_pauta', 'incluida_pauta')).status).toBe(201)
  expect((await proceeding('sessao', 'aprovado')).status).toBe(201)

  const outcomes = `http://localhost/api/v1/matters/${matter.id}/outcomes`
  const outcome = (body: unknown) => addOutcome(request(outcomes, admin.id, 'POST', body), context(matter.id))
  expect((await outcome({ kind: 'veto_parcial', actorName: 'Prefeito Municipal' })).status).toBe(422)
  const dueAt = new Date(Date.now() + 12 * 86400000).toISOString()
  const veto = await outcome({ kind: 'veto_parcial', actorName: 'Prefeito Municipal', notes: 'Veto parcial fundamentado no artigo 2.', dueAt })
  expect(veto.status).toBe(201)
  expect((await outcome({ kind: 'veto_parcial', actorName: 'Prefeito Municipal', notes: 'Veto repetido.' })).status).toBe(422)
  expect(await db.legislativeTask.count({ where: { tenantId: tenant.id, matterId: matter.id, status: 'pendente' } })).toBe(1)
  expect(await db.proceeding.count({ where: { matterId: matter.id } })).toBe(3)
  expect((await outcome({ kind: 'sancao', actorName: 'Prefeito Municipal' })).status).toBe(201)
  expect(await db.legislativeMatter.findUniqueOrThrow({ where: { id: matter.id } })).toMatchObject({ status: 'sancionado' })
  expect((await outcome({ kind: 'veto_total', actorName: 'Prefeito Municipal', notes: 'Não cabe após sanção.' })).status).toBe(422)

  const tasks = 'http://localhost/api/v1/tasks'
  const taskBody = { title: 'Revisar publicação da sanção', kind: 'parecer', dueAt: new Date(Date.now() - 3600000).toISOString(), matterId: matter.id, assigneeName: 'Secretaria' }
  expect((await createTask(request(tasks, outsider.id, 'POST', taskBody), { params: Promise.resolve({}) })).status).toBe(403)
  expect((await createTask(request(tasks, admin.id, 'POST', { ...taskBody, matterId: 'inexistente' }), { params: Promise.resolve({}) })).status).toBe(404)
  const createdTask = await createTask(request(tasks, operator.id, 'POST', taskBody), { params: Promise.resolve({}) })
  expect(createdTask.status).toBe(201)
  const task = (await createdTask.json()).task
  expect(task).toMatchObject({ status: 'pendente', kind: 'parecer', assigneeName: 'Secretaria', matterId: matter.id })
  const overdueRequest = new NextRequest(`${tasks}?overdue=true`, { headers: { 'x-actor-id': admin.id } })
  const overdue = await listTasks(overdueRequest, { params: Promise.resolve({}) })
  expect((await overdue.json()).counts.overdue).toBeGreaterThanOrEqual(1)
  const patch = (body: unknown) => updateTask(request(`http://localhost/api/v1/tasks/${task.id}`, operator.id, 'PATCH', body), context(task.id))
  expect((await patch({ status: 'cancelada' })).status).toBe(422)
  expect((await patch({ status: 'cancelada', justification: 'Prazo substituído pela publicação.' })).status).toBe(200)
  expect((await patch({ status: 'concluida' })).status).toBe(422)
  expect(await db.auditEvent.count({ where: { aggregateId: matter.id, action: 'matter.outcome' } })).toBe(2)
  expect(await db.outboxEvent.count({ where: { eventType: 'task.changed', aggregateId: task.id } })).toBe(2)
})
