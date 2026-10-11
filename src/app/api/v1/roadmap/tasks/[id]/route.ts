/**
 * PATCH /api/v1/roadmap/tasks/:id — atualiza o status de uma task da Onda 5
 * (v0.12.0). RBAC `platform.manage` (somente platform_owner): o roadmap é um
 * artefato da PLATAFORMA, fora do escopo de tenant — por isso a alteração fica
 * registrada na própria linha (status + autor + horário) e não na cadeia de
 * auditoria de tenant (padrão do SystemStatus / ScheduledJob do ROADMAP §12.1).
 *
 * Idempotente: mesmos dados → mesma resposta (updatedAt/updatedByName refletem
 * a última alteração real).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  status: z.enum(['pendente', 'em_andamento', 'concluido', 'bloqueado']),
})

export const PATCH = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, _correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')

    const { id } = await ctx.params
    const { status } = BodySchema.parse(await req.json())

    const task = await db.roadmapTask.findUnique({ where: { id } })
    if (!task) throw notFound('Task do roadmap não encontrada.')

    const updated = await db.roadmapTask.update({
      where: { id },
      data: { status, updatedByName: actor.name, updatedAt: new Date() },
    })

    return Response.json({
      task: {
        id: updated.id,
        phaseCode: updated.phaseCode,
        title: updated.title,
        detail: updated.detail,
        status: updated.status,
        order: updated.order,
        updatedByName: updated.updatedByName,
        updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : null,
      },
    })
  }
)
