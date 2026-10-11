/**
 * POST /api/v1/platform/onboarding/:id/reject — rejeição com nota obrigatória
 * (Onda 5 / Fase 24). RBAC platform.manage (exclusivo do platform_owner).
 *
 * Body: `{ note }` obrigatória (5–200 chars) — a nota é o feedback que a
 * câmara recebe (e fica registrada no pedido). Apenas pedidos `pendente`
 * podem ser rejeitados (422 caso contrário). O slug permanece OCUPADO no
 * histórico (evita reuso confuso); a câmara pode reabrir novo pedido com
 * outro slug. Auditoria `platform.onboarding_rejected` na cadeia do tenant
 * ÂNCORA (primeiro tenant ativo — pedido rejeitado ainda não tem tenant).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import type { OnboardingRequest } from '@prisma/client'
import type { OnboardingRequestView, OnboardingStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const rejectSchema = z.object({
  note: z
    .string()
    .trim()
    .min(5, 'Nota obrigatória (mín. 5 caracteres) — é o feedback para a câmara.')
    .max(200, 'Nota deve ter no máximo 200 caracteres.'),
})

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

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params

    const body = rejectSchema.parse(await req.json())

    const request = await db.onboardingRequest.findUnique({ where: { id } })
    if (!request) throw notFound('Pedido de onboarding não encontrado.')
    if (request.status !== 'pendente') {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Pedido não está pendente',
        `O pedido "${request.chamberName}" não pode ser rejeitado: status atual ` +
          `"${request.status}" (apenas pedidos pendentes podem ser rejeitados).`
      )
    }

    // Âncora multi-tenant para a cadeia de auditoria (pedido rejeitado não
    // tem tenant próprio) — mesmo padrão dos alertas de plataforma (ADR-021).
    const anchor = await db.tenant.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!anchor) throw notFound('Nenhum tenant ativo para ancorar a auditoria da plataforma.')

    const rejected = await withTransaction(async (tx) => {
      const updated = await tx.onboardingRequest.update({
        where: { id: request.id },
        data: { status: 'rejeitada', note: body.note },
      })

      await writeAudit(tx, {
        tenantId: anchor.id,
        actor,
        action: 'platform.onboarding_rejected',
        aggregateType: 'onboarding_request',
        aggregateId: request.id,
        summary:
          `Pedido de onboarding rejeitado: "${request.chamberName}" (${request.city}/${request.uf}, ` +
          `slug "${request.slug}", responsável ${request.email}). Nota: ${body.note}`,
        before: { status: 'pendente' },
        after: { status: 'rejeitada', note: body.note },
        justification: body.note,
        correlationId,
      })

      return updated
    })

    return Response.json({ request: toOnboardingRequestView(rejected) })
  }
)
