/**
 * PATCH /api/v1/platform/schedules/:id — pausar/retomar e ajustar intervalo de
 * um agendamento (Onda 5 / Fase 21). RBAC `platform.manage` (somente
 * platform_owner; o suporte lê via GET /platform/schedules).
 *
 * Body (Zod): `{ active?: boolean, everySeconds?: number }` — `everySeconds`
 * mínimo 60s (422 VALIDATION_ERROR caso contrário). Atualiza a linha e registra
 * a decisão de plataforma na PRÓPRIA linha (`updatedBy` = nome do ator +
 * `updatedAt`) — fora da cadeia de auditoria de tenant (padrão SystemStatus).
 *
 * `nextRunAt` NÃO é recalculado aqui: um job reativado com `nextRunAt` vencido
 * roda no próximo tick (catch-up único) e o novo intervalo passa a valer a
 * partir da execução seguinte.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toScheduledJobView } from '../serialize'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    everySeconds: z
      .number({ message: 'everySeconds deve ser um número de segundos.' })
      .int('everySeconds deve ser um número inteiro de segundos.')
      .min(60, 'Intervalo mínimo de 60 segundos entre execuções.')
      .max(2_592_000, 'Intervalo máximo de 30 dias (2.592.000 segundos).')
      .optional(),
  })
  .refine((v) => v.active !== undefined || v.everySeconds !== undefined, {
    message: 'Informe ao menos um campo: active ou everySeconds.',
  })

export const PATCH = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, _correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')

    const { id } = await ctx.params
    const job = await db.scheduledJob.findUnique({ where: { id } })
    if (!job) throw notFound('Agendamento não encontrado.')

    const body = patchSchema.parse(await req.json())

    const now = new Date()
    const updated = await db.scheduledJob.update({
      where: { id: job.id },
      data: {
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.everySeconds !== undefined ? { everySeconds: body.everySeconds } : {}),
        updatedBy: actor.name,
        updatedAt: now,
      },
    })

    return Response.json({ job: toScheduledJobView(updated) })
  }
)
