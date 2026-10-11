/**
 * POST /api/v1/platform/impersonations/:id/end — encerra a impersonação
 * (Fase 20 / ADR-021). RBAC `impersonation.manage` (resolvido sobre o usuário
 * REAL da sessão — durante a impersonação ativa a sessão enxerga o ALVO, que
 * não tem permissão para encerrá-la; sem sessão cai no demo x-actor-id).
 *
 * Encerra (endedAt=now) e limpa `impersonationId` de TODAS as sessões que
 * carregam a impersonação (a impersonação pode estar acoplada à sessão do
 * suporte que a iniciou). Auditoria `support.impersonation_ended` na cadeia do
 * tenant do ALVO. Idempotente: impersonação já encerrada → 200 sem mudança e
 * sem novo evento de auditoria.
 */
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound } from '@/lib/server/errors'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { endImpersonation } from '@/lib/server/session'
import { resolveSupportActor, toImpersonationView } from '@/lib/server/impersonation'
import type { Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveSupportActor(req)
    requirePermission(actor, 'impersonation.manage')

    const { id } = await ctx.params
    const imp = await db.supportImpersonation.findUnique({
      where: { id },
      include: {
        supportUser: { select: { id: true, name: true, role: true } },
        targetUser: { select: { id: true, name: true, tenantId: true } },
      },
    })
    if (!imp) throw notFound('Impersonação não encontrada.')

    // Alvo sempre tem tenant (validado na criação da impersonação); defesa extra.
    const targetTenantId = imp.targetUser.tenantId
    if (!targetTenantId) {
      throw notFound('Tenant do usuário-alvo não encontrado (impersonação inválida).')
    }

    // Já encerrada (idempotência): apenas devolve o estado atual.
    if (imp.endedAt) {
      return Response.json(toImpersonationView(imp, imp.supportUser.name, imp.targetUser.name))
    }

    const now = new Date()
    await withTransaction(async (tx) => {
      await tx.supportImpersonation.update({
        where: { id: imp.id },
        data: { endedAt: now },
      })
      // Limpa o acoplamento de TODAS as sessões que carregam esta impersonação.
      await tx.authSession.updateMany({
        where: { impersonationId: imp.id },
        data: { impersonationId: null },
      })
      await writeAudit(tx, {
        tenantId: targetTenantId,
        actor: { name: `${actor.name} (Suporte)`, role: actor.role as Role },
        action: 'support.impersonation_ended',
        aggregateType: 'support_impersonation',
        aggregateId: imp.id,
        summary: `Suporte encerrou a operação como ${imp.targetUser.name} (motivo registrado no início da impersonação).`,
        before: { impersonationId: imp.id, endedAt: null, active: true },
        after: { impersonationId: imp.id, endedAt: now.toISOString(), active: false },
        justification: imp.reason,
        correlationId,
      })
    })

    const updated = await db.supportImpersonation.findUnique({
      where: { id: imp.id },
    })
    return Response.json(
      toImpersonationView(updated!, imp.supportUser.name, imp.targetUser.name)
    )
  }
)
