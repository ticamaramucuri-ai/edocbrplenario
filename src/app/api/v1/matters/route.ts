/**
 * GET|POST /api/v1/matters — matérias legislativas.
 * GET: filtros search (ementa/autores contains), type, year, status.
 * POST: RBAC matter.write; number automático = max(number)+1 por (tenant, type, year).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { toMatterView, matterLabel } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const params = req.nextUrl.searchParams

  const search = params.get('search')?.trim()
  const type = params.get('type')?.trim()
  const yearRaw = params.get('year')?.trim()
  const status = params.get('status')?.trim()

  const year = yearRaw ? Number(yearRaw) : undefined
  if (yearRaw && (!Number.isInteger(year) || String(year).length !== 4)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Parâmetro "year" deve ser um ano de 4 dígitos.',
      { errors: { year: ['Ano inválido.'] } }
    )
  }

  const where: Prisma.LegislativeMatterWhereInput = { tenantId }
  if (search) {
    where.OR = [{ ementa: { contains: search } }, { authors: { contains: search } }]
  }
  if (type) where.type = type
  if (year) where.year = year
  if (status) where.status = status

  const matters = await db.legislativeMatter.findMany({
    where,
    orderBy: [{ year: 'desc' }, { number: 'desc' }],
    take: 200,
  })
  return Response.json({ matters: matters.map(toMatterView) })
})

const createSchema = z.object({
  type: z.enum(['projeto_de_lei', 'decreto_legislativo', 'requerimento', 'indicacao', 'mocao', 'emenda']),
  ementa: z.string().min(10, 'Ementa obrigatória (mín. 10 caracteres).').max(1000),
  authors: z.array(z.string().min(2)).min(1, 'Informe ao menos um autor.'),
  regime: z.enum(['ordinario', 'urgencia']).optional(),
  number: z.number().int().min(1).optional(),
  year: z.number().int().min(1990).max(2100).optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())
  const year = body.year ?? new Date().getFullYear()

  const created = await withTransaction(async (tx) => {
    let number = body.number
    if (number === undefined) {
      const last = await tx.legislativeMatter.findFirst({
        where: { tenantId, type: body.type, year },
        orderBy: { number: 'desc' },
        select: { number: true },
      })
      number = (last?.number ?? 0) + 1
    }
    const matter = await tx.legislativeMatter.create({
      data: {
        tenantId,
        type: body.type,
        number,
        year,
        ementa: body.ementa,
        authors: JSON.stringify(body.authors),
        status: 'em_tramitacao',
        regime: body.regime ?? 'ordinario',
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'matter.created',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `Matéria criada: ${matterLabel(matter)} — ${matter.ementa.slice(0, 60)}`,
      after: { type: matter.type, number: matter.number, year: matter.year, authors: body.authors },
      correlationId,
      ip: clientIp(req),
    })
    return matter
  })

  return Response.json({ matter: toMatterView(created) }, { status: 201 })
})
