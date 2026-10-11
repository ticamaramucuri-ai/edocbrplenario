/**
 * POST /api/v1/platform/tenants/:id/close — encerramento formal do tenant
 * (Fase 16 / ADR-017): exige justificativa (10–500) e confirmação digitada
 * "ENCERRAR". Em UMA transação: tenant active=false, revogação de TODAS as
 * sessões ativas dos usuários do tenant e assinatura → canceled (se ainda não
 * estiver). Dados NUNCA são apagados (retenção LGPD + cadeia de auditoria) —
 * reversível apenas por reativação auditada. Auditoria
 * `platform.tenant_closed` com justification e before/after. RBAC:
 * platform.manage.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const closeSchema = z.object({
  justification: z
    .string()
    .trim()
    .min(10, 'Justificativa obrigatória (mín. 10 caracteres).')
    .max(500, 'Justificativa deve ter no máximo 500 caracteres.'),
  confirm: z.literal('ENCERRAR', {
    message: 'Confirmação inválida: digite exatamente ENCERRAR.',
  }),
})

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params

    const body = closeSchema.parse(await req.json())

    const tenant = await db.tenant.findUnique({ where: { id } })
    if (!tenant) throw notFound('Tenant não encontrado.')
    if (!tenant.active) {
      throw new DomainError(
        'CONFLICT_VERSION',
        409,
        'Tenant já desativado',
        'Tenant já desativado — reative pelo console se necessário.'
      )
    }

    const revokedSessions = await withTransaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { active: false } })

      // Revoga TODAS as sessões ativas (cookie httpOnly) dos usuários do tenant.
      const sessions = await tx.authSession.updateMany({
        where: { user: { tenantId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      // Assinatura → canceled (idempotente: só se ainda não estiver).
      const subscription = await tx.subscription.updateMany({
        where: { tenantId: id, status: { not: 'canceled' } },
        data: { status: 'canceled' },
      })

      await writeAudit(tx, {
        tenantId: id,
        actor,
        action: 'platform.tenant_closed',
        aggregateType: 'tenant',
        aggregateId: id,
        summary:
          `Tenant "${tenant.name}" encerrado formalmente: ${sessions.count} sessão(ões) ` +
          `revogada(s) e assinatura cancelada (${subscription.count} atualizada(s)). ` +
          `Dados preservados por retenção (LGPD) e cadeia de auditoria intacta.`,
        before: { active: true },
        after: { active: false },
        justification: body.justification,
        correlationId,
      })

      return { sessions: sessions.count, subscription: subscription.count }
    })

    return Response.json({
      ok: true,
      message:
        `Tenant "${tenant.name}" encerrado: ${revokedSessions.sessions} sessão(ões) revogada(s), ` +
        'assinatura cancelada e dados preservados (retenção LGPD + auditoria).',
    })
  }
)
