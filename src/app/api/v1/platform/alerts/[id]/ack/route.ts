/**
 * POST /api/v1/platform/alerts/:id/ack — reconhece um alerta persistido
 * (Fase 20). RBAC `platform.manage` (somente platform_owner — o suporte lê,
 * o owner reconhece). Seta ackAt/ackBy (nome do ator) e audita
 * `platform.alert_acked` na cadeia do tenant indicado no meta do alerta (ou
 * no tenant ativo mais antigo quando o alerta é global — decisão documentada
 * em lib/server/platform-alerts.ts). Idempotente: alerta já reconhecido →
 * 200 sem mudança e sem novo evento.
 */
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { alertAuditTenantId, toPlatformAlertView } from '@/lib/server/platform-alerts'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')

    const { id } = await ctx.params
    const alert = await db.platformAlert.findUnique({ where: { id } })
    if (!alert) throw notFound('Alerta não encontrado.')

    // Idempotência: já reconhecido → devolve o estado atual sem re-auditar.
    if (alert.ackAt) {
      return Response.json({ alert: toPlatformAlertView(alert) })
    }

    const now = new Date()
    const tenantId = await alertAuditTenantId(alert.meta)

    await withTransaction(async (tx) => {
      const updated = await tx.platformAlert.updateMany({
        where: { id, ackAt: null },
        data: { ackAt: now, ackBy: actor.name },
      })
      if (updated.count > 0) {
        await writeAudit(tx, {
          tenantId,
          actor,
          action: 'platform.alert_acked',
          aggregateType: 'platform_alert',
          aggregateId: alert.id,
          summary: `Alerta "${alert.kind}" reconhecido: ${alert.message}`,
          before: { ackAt: null, ackBy: null, kind: alert.kind },
          after: { ackAt: now.toISOString(), ackBy: actor.name, kind: alert.kind },
          justification: null,
          correlationId,
        })
      }
    })

    const fresh = await db.platformAlert.findUnique({ where: { id } })
    return Response.json({ alert: toPlatformAlertView(fresh!) })
  }
)
