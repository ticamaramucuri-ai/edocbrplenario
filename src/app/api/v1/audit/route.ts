/**
 * GET /api/v1/audit — trilha de auditoria (RBAC audit.read).
 * Filtros: action (contains), aggregateType, aggregateId, limit (default 100,
 * máx 500). `verify=true` recalcula a cadeia de hash do tenant (ordem createdAt)
 * e devolve `{ events, chain: { valid, head } }` (ADR-004).
 */
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { verifyChain } from '@/lib/server/audit'
import { toAuditView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'audit.read')
  const tenantId = await resolveTenantScope(req, actor)

  const params = req.nextUrl.searchParams
  const action = params.get('action')?.trim()
  const aggregateType = params.get('aggregateType')?.trim()
  const aggregateId = params.get('aggregateId')?.trim()
  const limitRaw = params.get('limit')
  const verify = params.get('verify') === 'true'

  let limit = 100
  if (limitRaw) {
    const parsed = Number(limitRaw)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return Response.json(
        { detail: 'Parâmetro "limit" deve ser inteiro positivo.' },
        { status: 422 }
      )
    }
    limit = Math.min(parsed, 500)
  }

  const where: Prisma.AuditEventWhereInput = { tenantId }
  if (action) where.action = { contains: action }
  if (aggregateType) where.aggregateType = aggregateType
  if (aggregateId) where.aggregateId = aggregateId

  const [events, chain] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    verify
      ? db.auditEvent
          .findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
          .then((all) => verifyChain(all))
      : null,
  ])

  return Response.json({
    events: events.map(toAuditView),
    ...(chain ? { chain: { valid: chain.valid, head: chain.head } } : {}),
  })
})
