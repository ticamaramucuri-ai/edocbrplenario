/**
 * GET|POST /api/v1/matters/:id/versions — versões do texto integral.
 * POST: RBAC matter.write; version = última+1 (concorrência → 409).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { loadMatter } from '@/lib/server/loaders'
import { toMatterVersionView, matterLabel } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)
  const versions = await db.matterVersion.findMany({
    where: { matterId: matter.id },
    orderBy: { version: 'desc' },
  })
  return Response.json({ versions: versions.map(toMatterVersionView) })
})

const createSchema = z.object({
  text: z.string().min(10, 'Texto da versão obrigatório (mín. 10 caracteres).').max(500000),
  authorName: z.string().min(2).max(120).optional(),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())
  const matter = await loadMatter(actor, id)

  const version = await withTransaction(async (tx) => {
    const last = await tx.matterVersion.findFirst({
      where: { matterId: matter.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1
    const created = await tx.matterVersion.create({
      data: {
        matterId: matter.id,
        version: nextVersion,
        text: body.text,
        authorName: body.authorName?.trim() ?? actor.name,
      },
    })
    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.version_created',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `${matterLabel(matter)} — versão nº ${nextVersion} registrada (${created.authorName}).`,
      after: { version: nextVersion, authorName: created.authorName, sizeChars: created.text.length },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json({ version: toMatterVersionView(version) }, { status: 201 })
})
