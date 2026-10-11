/**
 * GET /api/v1/platform/onboarding — console do self-onboarding (Fase 24).
 *
 * RBAC `platform.read` (platform_owner E platform_support — o suporte
 * acompanha a fila; ativar/rejeitar segue exclusivo do owner via
 * platform.manage nas sub-rotas). Lista TODOS os pedidos (pendentes +
 * histórico ativadas/rejeitadas) ordenados por createdAt desc.
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import type { OnboardingRequest } from '@prisma/client'
import type { OnboardingRequestView, OnboardingStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

/** Serialização canônica do pedido (contrato OnboardingRequestView). */
function toOnboardingRequestView(r: OnboardingRequest): OnboardingRequestView {
  return {
    id: r.id,
    chamberName: r.chamberName,
    city: r.city,
    uf: r.uf,
    email: r.email,
    slug: r.slug,
    status: r.status as OnboardingStatus,
    note: r.note ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  const requests = await db.onboardingRequest.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({ requests: requests.map(toOnboardingRequestView) })
})
