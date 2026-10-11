/** Conferência em duas identidades para contagem simbólica; revisões anteriores permanecem consultáveis. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadVoting } from '@/lib/server/loaders'
import { currentAttendance } from '@/lib/server/domain'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['propose', 'confirm']),
  version: z.number().int().min(1),
  revisionId: z.string().optional(),
  sim: z.number().int().min(0).optional(),
  nao: z.number().int().min(0).optional(),
  abstencoes: z.number().int().min(0).optional(),
  customCounts: z.record(z.string(), z.number().int().min(0)).optional(),
})

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'voting.write')
  const { id } = await ctx.params
  const voting = await loadVoting(actor, id)
  if (voting.mode !== 'simbolico') throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Modo incompatível', 'A conferência só se aplica à votação simbólica.')
  const revisions = await db.symbolicTallyRevision.findMany({ where: { votingId: id }, orderBy: { revision: 'desc' } })
  return Response.json({ revisions: revisions.map((row) => ({ ...row, counts: JSON.parse(row.countsJson), countsJson: undefined })) })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'voting.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())
  const voting = await loadVoting(actor, id)
  if (voting.mode !== 'simbolico' || !voting.session.official) throw new DomainError('VOTING_INVALID_TRANSITION', 409,
    'Modo incompatível', 'A conferência dupla é destinada a votações simbólicas de sessões oficiais.')
  if (body.action === 'propose' && !['session_operator', 'tenant_admin'].includes(actor.role)) {
    throw new DomainError('FORBIDDEN_ROLE', 403, 'Papel incompatível', 'A contagem deve ser proposta pela secretaria ou administração da Câmara.')
  }
  if (body.action === 'confirm' && !['presiding_officer', 'tenant_admin'].includes(actor.role)) {
    throw new DomainError('FORBIDDEN_ROLE', 403, 'Papel incompatível', 'A conferência deve ser feita pela Presidência ou administração da Câmara.')
  }

  const result = await withTransaction(async (tx) => {
    const current = await tx.voting.findUniqueOrThrow({ where: { id } })
    const session = await tx.session.findUniqueOrThrow({ where: { id: current.sessionId } })
    if (current.version !== body.version || !['open', 'paused'].includes(current.status) ||
        !['open', 'resumed'].includes(session.status)) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Estado alterado', 'Atualize a votação antes de registrar a conferência.')
    }
    const latest = await tx.symbolicTallyRevision.findFirst({ where: { votingId: id }, orderBy: { revision: 'desc' } })
    let revision
    if (body.action === 'propose') {
      if (latest?.confirmedAt) throw new DomainError('VOTING_INVALID_TRANSITION', 409, 'Contagem já confirmada',
        'A contagem confirmada não pode ser substituída sem procedimento formal de retificação.')
      const options = await tx.votingOption.findMany({ where: { votingId: id }, orderBy: { order: 'asc' } })
      let counts: Record<string, number>
      if (options.length) {
        const keys = options.map((option) => option.key)
        if (!body.customCounts || keys.some((key) => body.customCounts?.[key] === undefined) ||
            Object.keys(body.customCounts).some((key) => !keys.includes(key))) {
          throw new DomainError('VALIDATION_ERROR', 422, 'Contagem inválida', 'Informe exatamente as contagens das opções desta votação.')
        }
        counts = Object.fromEntries(keys.map((key) => [key, body.customCounts![key]]))
      } else {
        if (body.sim === undefined || body.nao === undefined || body.abstencoes === undefined || body.customCounts) {
          throw new DomainError('VALIDATION_ERROR', 422, 'Contagem inválida', 'Informe sim, nao e abstencoes sem opções extras.')
        }
        counts = { sim: body.sim, nao: body.nao, abstencoes: body.abstencoes }
      }
      const frozenIds = current.eligibleVoterIdsAtOpen ? JSON.parse(current.eligibleVoterIdsAtOpen) as string[] : null
      const { quorum } = await currentAttendance(tx, session.id, session.tenantId, frozenIds)
      if (Object.values(counts).reduce((sum, count) => sum + count, 0) > quorum.present) {
        throw new DomainError('VALIDATION_ERROR', 422, 'Contagem inválida', 'A soma supera a presença atual da base deliberativa.')
      }
      revision = await tx.symbolicTallyRevision.create({ data: { votingId: id, revision: (latest?.revision ?? 0) + 1,
        countsJson: JSON.stringify(counts), proposedById: actor.id, proposedByName: actor.name } })
    } else {
      if (!latest || latest.id !== body.revisionId || latest.confirmedAt) {
        throw new DomainError('CONFLICT_VERSION', 409, 'Revisão alterada', 'Confirme somente a revisão pendente mais recente.')
      }
      if (latest.proposedById === actor.id) {
        throw new DomainError('FORBIDDEN_ROLE', 403, 'Conferência independente', 'Outra pessoa deve confirmar a contagem.')
      }
      revision = await tx.symbolicTallyRevision.update({ where: { id: latest.id },
        data: { confirmedById: actor.id, confirmedByName: actor.name, confirmedAt: new Date() } })
    }
    const changed = await tx.voting.updateMany({ where: { id, version: body.version, status: current.status },
      data: { version: { increment: 1 } } })
    if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Votação alterada', 'Atualize a votação.')
    await writeAudit(tx, { tenantId: session.tenantId, actor, action: body.action === 'propose' ? 'voting.symbolic_tally.proposed' : 'voting.symbolic_tally.confirmed',
      aggregateType: 'voting', aggregateId: id, summary: `Contagem simbólica ${body.action === 'propose' ? 'proposta' : 'confirmada'} na revisão ${revision.revision}.`,
      after: { revisionId: revision.id, revision: revision.revision, counts: JSON.parse(revision.countsJson),
        proposedById: revision.proposedById, confirmedById: revision.confirmedById }, correlationId, ip: clientIp(req) })
    const statePayload = { votingId: id, sessionId: session.id, status: current.status }
    await emitOutbox(tx, { tenantId: session.tenantId, eventType: 'voting.state_changed', aggregateId: id,
      sessionId: session.id, aggregateVersion: current.version + 1, correlationId,
      internalPayload: { ...statePayload, tallyRevision: revision.revision, tallyConfirmed: !!revision.confirmedAt },
      publicPayload: statePayload })
    return { revision, version: current.version + 1 }
  })
  return Response.json({ revision: { ...result.revision, counts: JSON.parse(result.revision.countsJson), countsJson: undefined }, version: result.version })
})
