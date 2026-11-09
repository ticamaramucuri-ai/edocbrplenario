/**
 * GET  /api/v1/platform/plans — lista planos comerciais (com contagem de
 *       assinaturas por plano).
 * POST /api/v1/platform/plans — cria plano {name, priceCents, limits} (limits
 *       é objeto JSON validado: maxParliamentarians, maxSessionsPerMonth,
 *       features). RBAC: platform.manage (somente platform_owner).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'

export const dynamic = 'force-dynamic'

function toPlanView(plan: { id: string; name: string; priceCents: number; limits: string; active: boolean; createdAt: Date; updatedAt: Date }, subscriptions = 0) {
  let limits: { maxParliamentarians?: number; maxSessionsPerMonth?: number;
    maxTransferPackageMiB?: number; features?: string[] } = {}
  try {
    limits = JSON.parse(plan.limits)
  } catch {
    limits = {}
  }
  return {
    id: plan.id,
    name: plan.name,
    priceCents: plan.priceCents,
    active: plan.active,
    limits: {
      maxParliamentarians: typeof limits.maxParliamentarians === 'number' ? limits.maxParliamentarians : null,
      maxSessionsPerMonth: typeof limits.maxSessionsPerMonth === 'number' ? limits.maxSessionsPerMonth : null,
      maxTransferPackageMiB: typeof limits.maxTransferPackageMiB === 'number' ? limits.maxTransferPackageMiB : null,
      features: Array.isArray(limits.features) ? limits.features.map(String) : [],
    },
    subscriptions,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  }
}

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')

  const plans = await db.plan.findMany({ orderBy: { priceCents: 'asc' }, include: { _count: { select: { subscriptions: true } } } })
  return Response.json({ plans: plans.map((p) => toPlanView(p, p._count.subscriptions)) })
})

const limitsSchema = z
  .object({
    maxParliamentarians: z.number().int().min(0).max(10000).optional(),
    maxSessionsPerMonth: z.number().int().min(0).max(10000).optional(),
    maxTransferPackageMiB: z.number().int().min(1).max(512).optional(),
    features: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict()

const createSchema = z.object({
  name: z.string().min(2, 'Nome do plano deve ter ao menos 2 caracteres.').max(80),
  priceCents: z.number().int().min(0).max(100_000_000),
  limits: limitsSchema.optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')
  const body = createSchema.parse(await req.json())

  const taken = await db.plan.findUnique({ where: { name: body.name } })
  if (taken) {
    return Response.json(
      {
        type: 'https://legis-saas/errors/validation-error',
        title: 'Dados inválidos',
        status: 422,
        detail: `Já existe um plano chamado "${body.name}".`,
        code: 'VALIDATION_ERROR',
        correlationId,
        errors: { name: ['Nome já utilizado.'] },
      },
      { status: 422 }
    )
  }

  const plan = await db.plan.create({
    data: {
      name: body.name,
      priceCents: body.priceCents,
      limits: JSON.stringify(body.limits ?? {}),
    },
  })
  return Response.json({ plan: toPlanView(plan) }, { status: 201 })
})
