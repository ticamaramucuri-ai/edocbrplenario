/**
 * GET|POST /api/v1/committees/:id/members — composição da comissão.
 * GET: membros (histórico) com dados do parlamentar. POST: adiciona membro
 * (RBAC structure.write); parlamentar já membro com vigência aberta → 422.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toCommitteeMemberView } from '@/lib/server/serializers'
import { COMMITTEE_MEMBER_ROLE_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const committee = await db.committee.findUnique({ where: { id } })
  if (!committee) throw notFound('Comissão não encontrada.')
  assertTenantScope(actor, committee.tenantId)

  const members = await db.committeeMember.findMany({
    where: { committeeId: committee.id },
    include: { parliamentarian: true },
    orderBy: [{ endDate: 'asc' }, { startDate: 'desc' }],
  })
  return Response.json({ members: members.map(toCommitteeMemberView) })
})

const createSchema = z.object({
  parliamentarianId: z.string().min(1, 'Parlamentar obrigatório.'),
  role: z.enum(['presidente', 'vice', 'relator', 'titular', 'suplente']).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'structure.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())

  const committee = await db.committee.findUnique({ where: { id } })
  if (!committee) throw notFound('Comissão não encontrada.')
  assertTenantScope(actor, committee.tenantId)
  const parliamentarian = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
  if (!parliamentarian) throw notFound('Parlamentar não encontrado.')
  assertTenantScope(actor, parliamentarian.tenantId)

  const member = await withTransaction(async (tx) => {
    const open = await tx.committeeMember.findFirst({
      where: { committeeId: committee.id, parliamentarianId: parliamentarian.id, endDate: null },
      select: { id: true },
    })
    if (open) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Membro já ativo',
        `${parliamentarian.name} já é membro ativo desta comissão.`
      )
    }
    const created = await tx.committeeMember.create({
      data: {
        committeeId: committee.id,
        parliamentarianId: parliamentarian.id,
        role: body.role ?? 'titular',
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
      },
      include: { parliamentarian: true },
    })
    await writeAudit(tx, {
      tenantId: committee.tenantId,
      actor,
      action: 'committee.member_added',
      aggregateType: 'committee',
      aggregateId: committee.id,
      summary: `${parliamentarian.name} ingressou na ${committee.acronym} como ${COMMITTEE_MEMBER_ROLE_LABEL[created.role]}.`,
      after: { committee: committee.acronym, parliamentarian: parliamentarian.name, role: created.role },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: committee.tenantId,
      eventType: 'structure.changed',
      aggregateId: committee.id,
      aggregateVersion: 2,
      correlationId,
      origin: 'operator',
      internalPayload: {
        entity: 'committee_member',
        event: 'added',
        committeeId: committee.id,
        committee: committee.acronym,
        parliamentarian: parliamentarian.name,
        role: created.role,
      },
    })
    return created
  })

  return Response.json({ member: toCommitteeMemberView(member) }, { status: 201 })
})
