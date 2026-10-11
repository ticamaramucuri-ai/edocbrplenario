/**
 * POST /api/v1/platform/billing/cycle — executa o ciclo de faturamento do mês
 * corrente (corpo vazio): gera as faturas de competência do mês para todos os
 * tenants ativos com assinatura trial/active/past_due (skips silenciosos
 * contam como ignorados) e roda o dunning das faturas abertas vencidas
 * (assinatura trial/active → past_due + notificação ao tenant_admin + evento
 * `billing.invoice_overdue`). Resposta: { generated, skipped, dunning }.
 * RBAC: platform.manage (somente platform_owner).
 */
import { withTransaction } from '@/lib/server/tx'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { runBillingCycle } from '@/lib/server/billing'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')

  // Corpo vazio por contrato — o ciclo opera sempre o mês corrente.
  const result = await withTransaction((tx) => runBillingCycle(tx, { actor, correlationId }))
  return Response.json(result)
})
