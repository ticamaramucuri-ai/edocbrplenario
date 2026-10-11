/**
 * GET|POST /api/v1/tasks — prazos e pendências do processo legislativo.
 * GET: filtros status / overdue (pendente && dueAt < now) + contagens.
 * POST: RBAC task.write; emite outbox `task.changed` (interno).
 */
import type { NextRequest } from 'next/server'
import type { LegislativeMatter } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { notify } from '@/lib/server/notify'
import { toLegislativeTaskView, matterLabel } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const params = req.nextUrl.searchParams
  const status = params.get('status')?.trim()
  const overdue = params.get('overdue')?.trim() === 'true'
  const now = new Date()

  const where = {
    tenantId,
    ...(status ? { status } : {}),
    ...(overdue ? { status: 'pendente', dueAt: { lt: now } } : {}),
  }
  const [tasks, counts] = await Promise.all([
    db.legislativeTask.findMany({
      where,
      include: { matter: true },
      orderBy: { dueAt: 'asc' },
      take: 300,
    }),
    db.legislativeTask.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    }),
  ])
  const countsMap: Record<string, number> = { pendente: 0, concluida: 0, cancelada: 0 }
  for (const g of counts) countsMap[g.status] = g._count._all
  const overdueCount = await db.legislativeTask.count({
    where: { tenantId, status: 'pendente', dueAt: { lt: now } },
  })

  return Response.json({
    tasks: tasks.map((t) => toLegislativeTaskView(t, t.matter)),
    counts: { ...countsMap, overdue: overdueCount },
  })
})

const createSchema = z.object({
  title: z.string().min(3, 'Título obrigatório.').max(200),
  kind: z.enum(['prazo', 'parecer', 'distribuicao', 'outro']).optional(),
  dueAt: z.string().datetime({ offset: true, error: 'Prazo (data/hora) obrigatório.' }),
  matterId: z.string().nullable().optional(),
  assigneeName: z.string().max(120).optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'task.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  let matter: LegislativeMatter | null = null
  if (body.matterId) {
    matter = await db.legislativeMatter.findUnique({ where: { id: body.matterId } })
    if (!matter) throw notFound('Matéria vinculada não encontrada.')
    assertTenantScope(actor, matter.tenantId)
  }

  const task = await withTransaction(async (tx) => {
    const created = await tx.legislativeTask.create({
      data: {
        tenantId,
        matterId: matter?.id ?? null,
        title: body.title.trim(),
        kind: body.kind ?? 'prazo',
        dueAt: new Date(body.dueAt),
        status: 'pendente',
        assigneeName: body.assigneeName?.trim() ?? null,
      },
      include: { matter: true },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'task.created',
      aggregateType: 'task',
      aggregateId: created.id,
      summary: `Tarefa criada: ${created.title}${matter ? ` (${matterLabel(matter)})` : ''}.`,
      after: { title: created.title, kind: created.kind, dueAt: created.dueAt, assigneeName: created.assigneeName },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId,
      eventType: 'task.changed',
      aggregateId: created.id,
      aggregateVersion: 1,
      correlationId,
      origin: 'operator',
      internalPayload: {
        taskId: created.id,
        title: created.title,
        status: created.status,
        dueAt: created.dueAt.toISOString(),
        assigneeName: created.assigneeName,
      },
    })
    // Fase 6 — notificação de tarefa criada (administração legislativa)
    await notify(tx, {
      tenantId,
      title: `Nova tarefa: ${created.title}`,
      body: `${matter ? `${matterLabel(matter)} — ` : ''}Prazo: ${created.dueAt.toLocaleString('pt-BR')}${created.assigneeName ? ` · Responsável: ${created.assigneeName}` : ''}.`,
      kind: 'task',
      module: 'workflow',
      targetRole: 'legislative_admin',
    })
    return created
  })

  return Response.json({ task: toLegislativeTaskView(task, task.matter) }, { status: 201 })
})
