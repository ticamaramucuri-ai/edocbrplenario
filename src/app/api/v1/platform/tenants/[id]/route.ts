/**
 * PATCH /api/v1/platform/tenants/:id — ativar/desativar tenant e trocar plano
 * (entitlements mudam imediatamente para o novo plano). Auditoria
 * platform.tenant_updated na cadeia do tenant afetado. RBAC: platform.manage.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  active: z.boolean().optional(),
  planId: z.string().min(1).optional(),
})

function safeFeatures(limitsJson: string): string[] {
  try {
    const parsed = JSON.parse(limitsJson) as { features?: unknown }
    return Array.isArray(parsed.features) ? parsed.features.map(String) : []
  } catch {
    return []
  }
}

export const PATCH = apiHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  if (body.active === undefined && body.planId === undefined) {
    return Response.json(
      {
        type: 'https://legis-saas/errors/validation-error',
        title: 'Dados inválidos',
        status: 422,
        detail: 'Informe ao menos um campo: active ou planId.',
        code: 'VALIDATION_ERROR',
        correlationId,
        errors: { _body: ['Nada a atualizar.'] },
      },
      { status: 422 }
    )
  }

  const tenant = await db.tenant.findUnique({ where: { id }, include: { subscription: { include: { plan: true } } } })
  if (!tenant) throw notFound(`Tenant "${id}" não encontrado.`)

  let planName: string | null = null
  if (body.planId) {
    const plan = await db.plan.findUnique({ where: { id: body.planId } })
    if (!plan || !plan.active) throw notFound(`Plano "${body.planId}" não encontrado ou inativo.`)
    planName = plan.name
  }

  const before = {
    active: tenant.active,
    plan: tenant.subscription?.plan.name ?? null,
  }

  await withTransaction(async (tx) => {
    await tx.tenant.update({
      where: { id },
      data: { active: body.active ?? tenant.active, ...(planName ? { plan: planName } : {}) },
    })
    if (body.planId) {
      const existing = await tx.subscription.findUnique({ where: { tenantId: id } })
      if (existing) {
        await tx.subscription.update({ where: { id: existing.id }, data: { planId: body.planId } })
      } else {
        await tx.subscription.create({ data: { tenantId: id, planId: body.planId, status: 'active' } })
      }
    }
    await writeAudit(tx, {
      tenantId: id,
      actor,
      action: 'platform.tenant_updated',
      aggregateType: 'platform',
      aggregateId: id,
      summary: `Tenant "${tenant.name}" atualizado pelo console da plataforma${body.active !== undefined ? ` — ${body.active ? 'ativado' : 'desativado'}` : ''}${planName ? ` — plano alterado para ${planName}` : ''}.`,
      before,
      after: { active: body.active ?? tenant.active, plan: planName ?? before.plan },
      justification: 'Operação do console da plataforma (platform_owner).',
      correlationId,
    })
  })

  const [updated, subscription] = await Promise.all([
    db.tenant.findUnique({ where: { id } }),
    db.subscription.findUnique({ where: { tenantId: id }, include: { plan: true } }),
  ])

  return Response.json({
    tenant: {
      id: updated!.id,
      name: updated!.name,
      slug: updated!.slug,
      city: updated!.city,
      uf: updated!.uf,
      active: updated!.active,
      createdAt: updated!.createdAt.toISOString(),
      subscription: subscription
        ? {
            status: subscription.status,
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
            plan: {
              id: subscription.plan.id,
              name: subscription.plan.name,
              priceCents: subscription.plan.priceCents,
              features: safeFeatures(subscription.plan.limits),
            },
          }
        : null,
    },
  })
})
