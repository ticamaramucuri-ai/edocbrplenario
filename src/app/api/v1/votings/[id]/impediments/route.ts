import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadVoting } from '@/lib/server/loaders'
import { currentAttendance, tenantSettings } from '@/lib/server/domain'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['register', 'revoke']),
  parliamentarianId: z.string().min(1),
  version: z.number().int().min(1),
  reason: z.string().trim().min(10).max(2000),
}).strict()

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'voting.write')
  const { id } = await ctx.params
  const voting = await loadVoting(actor, id)
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: voting.session.tenantId } })
  const impediments = await db.votingImpediment.findMany({
    where: { votingId: id, revokedAt: null },
    include: { parliamentarian: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return Response.json({ policy: tenantSettings(tenant).votingImpedimentPolicy,
    policyAtOpen: voting.impedimentPolicyAtOpen,
    impediments: impediments.map(({ parliamentarian, ...row }) => ({ ...row,
      parliamentarianName: parliamentarian.name })) })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'voting.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())
  await loadVoting(actor, id)

  const result = await withTransaction(async (tx) => {
    const voting = await tx.voting.findUniqueOrThrow({ where: { id }, include: { session: true } })
    if (voting.version !== body.version) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'Recarregue a votação antes de alterar impedimentos.')
    if (voting.status !== 'ready') throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Votação já iniciada', 'Impedimentos só podem ser alterados antes da abertura.')
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: voting.session.tenantId } })
    const policy = tenantSettings(tenant).votingImpedimentPolicy
    if (body.action === 'register' && policy === 'disabled') throw new DomainError('VOTING_INVALID_TRANSITION', 409,
      'Política desativada', 'Configure a política de impedimentos desta Câmara antes do registro.')
    const { rows } = await currentAttendance(tx, voting.sessionId, voting.session.tenantId)
    const person = rows.find((row) => row.parliamentarianId === body.parliamentarianId)
    if (!person) throw new DomainError('VALIDATION_ERROR', 422, 'Parlamentar inelegível', 'O parlamentar não pertence à base deliberativa desta sessão.')
    const existing = await tx.votingImpediment.findUnique({ where: {
      votingId_parliamentarianId: { votingId: id, parliamentarianId: person.parliamentarianId },
    } })
    if (body.action === 'register') {
      if (existing && !existing.revokedAt) throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Impedimento existente', 'Este parlamentar já está impedido nesta votação.')
      if (existing) await tx.votingImpediment.update({ where: { id: existing.id }, data: {
        reason: body.reason, actorId: actor.id, createdAt: new Date(), revokedAt: null, revokedBy: null, revocationReason: null,
      } })
      else await tx.votingImpediment.create({ data: { votingId: id, parliamentarianId: person.parliamentarianId,
        reason: body.reason, actorId: actor.id } })
    } else {
      if (!existing || existing.revokedAt) throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Impedimento inexistente', 'Não há impedimento ativo para revogar.')
      await tx.votingImpediment.update({ where: { id: existing.id }, data: {
        revokedAt: new Date(), revokedBy: actor.id, revocationReason: body.reason,
      } })
    }
    const update = await tx.voting.updateMany({ where: { id, version: body.version, status: 'ready' },
      data: { version: { increment: 1 } } })
    if (update.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'Recarregue a votação.')
    const action = body.action === 'register' ? 'voting.impediment_registered' : 'voting.impediment_revoked'
    await writeAudit(tx, { tenantId: voting.session.tenantId, actor, action, aggregateType: 'voting', aggregateId: id,
      summary: `${body.action === 'register' ? 'Impedimento registrado' : 'Impedimento revogado'}: ${person.name}.`,
      before: existing ? { active: !existing.revokedAt, reason: existing.reason } : null,
      after: { active: body.action === 'register', parliamentarianId: person.parliamentarianId, reason: body.reason },
      correlationId, ip: clientIp(req) })
    await emitOutbox(tx, { tenantId: voting.session.tenantId, eventType: 'voting.state_changed', aggregateId: id,
      sessionId: voting.sessionId, aggregateVersion: body.version + 1, correlationId,
      internalPayload: { votingId: id, action, parliamentarianId: person.parliamentarianId },
    })
    return { version: body.version + 1 }
  })
  return Response.json(result)
})
