/**
 * PATCH /api/v1/tasks/:id — concluir ou cancelar tarefa. RBAC task.write.
 * (session_operator também conclui — fluxo operacional da sessão.)
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toLegislativeTaskView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  status: z.enum(['concluida', 'cancelada']),
  justification: z.string().min(5, 'Justificativa obrigatória para cancelar.').optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'task.write')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const current = await db.legislativeTask.findUnique({ where: { id }, include: { matter: true } })
  if (!current) throw notFound('Tarefa não encontrada.')
  assertTenantScope(actor, current.tenantId)

  if (current.status !== 'pendente') {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Tarefa encerrada',
      `Tarefa já está em status "${current.status}" — apenas tarefas pendentes mudam de status.`
    )
  }
  if (body.status === 'cancelada' && !body.justification) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Cancelamento de tarefa exige justificativa.',
      { errors: { justification: ['Informe a justificativa do cancelamento.'] } }
    )
  }

  const task = await withTransaction(async (tx) => {
    const updated = await tx.legislativeTask.update({
      where: { id: current.id },
      data: { status: body.status },
      include: { matter: true },
    })
    await writeAudit(tx, {
      tenantId: current.tenantId,
      actor,
      action: body.status === 'concluida' ? 'task.completed' : 'task.cancelled',
      aggregateType: 'task',
      aggregateId: current.id,
      summary: `Tarefa ${body.status === 'concluida' ? 'concluída' : 'cancelada'}: ${current.title}.`,
      before: { status: current.status },
      after: { status: updated.status },
      justification: body.status === 'cancelada' ? body.justification : null,
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: current.tenantId,
      eventType: 'task.changed',
      aggregateId: current.id,
      aggregateVersion: 2,
      correlationId,
      origin: 'operator',
      internalPayload: {
        taskId: current.id,
        title: current.title,
        status: updated.status,
        dueAt: updated.dueAt.toISOString(),
        assigneeName: updated.assigneeName,
      },
    })
    return updated
  })

  return Response.json({ task: toLegislativeTaskView(task, task.matter) })
})
