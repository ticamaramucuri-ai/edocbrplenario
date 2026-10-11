/**
 * PATCH /api/v1/platform/plans/:id — {active?, priceCents?, limits?}.
 * RBAC: platform.manage (somente platform_owner).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  active: z.boolean().optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  limits: z
    .object({
      maxParliamentarians: z.number().int().min(0).max(10000).optional(),
      maxSessionsPerMonth: z.number().int().min(0).max(10000).optional(),
      features: z.array(z.string().min(1)).max(50).optional(),
    })
    .strict()
    .optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const plan = await db.plan.findUnique({ where: { id } })
  if (!plan) throw notFound(`Plano "${id}" não encontrado.`)

  const updated = await db.plan.update({
    where: { id },
    data: {
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.priceCents !== undefined ? { priceCents: body.priceCents } : {}),
      ...(body.limits !== undefined ? { limits: JSON.stringify(body.limits) } : {}),
    },
  })

  let limits: { maxParliamentarians?: number; maxSessionsPerMonth?: number; features?: string[] } = {}
  try {
    limits = JSON.parse(updated.limits)
  } catch {
    limits = {}
  }

  return Response.json({
    plan: {
      id: updated.id,
      name: updated.name,
      priceCents: updated.priceCents,
      active: updated.active,
      limits: {
        maxParliamentarians: typeof limits.maxParliamentarians === 'number' ? limits.maxParliamentarians : null,
        maxSessionsPerMonth: typeof limits.maxSessionsPerMonth === 'number' ? limits.maxSessionsPerMonth : null,
        features: Array.isArray(limits.features) ? limits.features.map(String) : [],
      },
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  })
})
