/**
 * Entitlements (Fase 8) — recursos do plano do tenant.
 *
 * Fonte de verdade: Subscription → Plan.limits.features (JSON).
 * Regra de default: tenant SEM assinatura tem TUDO habilitado (o gate só
 * restringe quando existe uma assinatura em plano que NÃO inclui o recurso).
 * Papéis platform_* (tenantId null) têm escopo global: sempre habilitado.
 */
import { db } from '@/lib/db'
import { DomainError } from './errors'

export type PlanLimits = {
  maxParliamentarians?: number
  maxSessionsPerMonth?: number
  maxTransferPackageMiB?: number
  features?: string[]
}

/** Recursos gateáveis conhecidos (documentação viva; outros valores são livres). */
export const KNOWN_FEATURES = ['ai_assist', 'white_label_avancado', 'api_publica'] as const

export function parsePlanLimits(raw: string): PlanLimits {
  try {
    const parsed = JSON.parse(raw) as PlanLimits
    return {
      maxParliamentarians: typeof parsed.maxParliamentarians === 'number' ? parsed.maxParliamentarians : undefined,
      maxSessionsPerMonth: typeof parsed.maxSessionsPerMonth === 'number' ? parsed.maxSessionsPerMonth : undefined,
      maxTransferPackageMiB: Number.isSafeInteger(parsed.maxTransferPackageMiB) &&
        parsed.maxTransferPackageMiB! >= 1 && parsed.maxTransferPackageMiB! <= 512
        ? parsed.maxTransferPackageMiB : undefined,
      features: Array.isArray(parsed.features) ? parsed.features.map(String) : [],
    }
  } catch {
    return {}
  }
}

/**
 * O tenant tem direito ao recurso? Sem assinatura → true (default aberto);
 * com assinatura → o plano precisa incluir o recurso em limits.features.
 */
export async function tenantEntitled(tenantId: string | null, feature: string): Promise<boolean> {
  if (!tenantId) return true // escopo global (platform_*)
  const subscription = await db.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  })
  if (!subscription) return true
  const limits = parsePlanLimits(subscription.plan.limits)
  return limits.features?.includes(feature) ?? false
}

/** Versão com erro: 402 PLAN_LIMIT quando o plano não inclui o recurso. */
export async function requireEntitled(tenantId: string | null, feature: string): Promise<void> {
  const entitled = await tenantEntitled(tenantId, feature)
  if (!entitled) {
    const plan = tenantId
      ? (await db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }))?.plan
      : null
    throw new DomainError(
      'PLAN_LIMIT',
      402,
      'Recurso não incluído no plano',
      `O recurso "${feature}" não está incluído no plano atual${plan ? ` (${plan.name})` : ''}. ` +
        'Entre em contato com a operação da plataforma para upgrade.'
    )
  }
}
