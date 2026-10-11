/**
 * GET /api/v1/votings/:id/receipts — verificação de recibos de voto (Fase 18,
 * ADR-019). RBAC: `audit.read` OU `voting.write` (OR de permissões — não há
 * helper no projeto; verificado contra a matriz PERMISSIONS do rbac.ts).
 *
 * Recomputa o HMAC determinístico de CADA voto armazenado (value + closedAt
 * ISO — placeholder de sigilo em votação secreta) e compara com o
 * `receiptCode` persistido:
 * - recomputedCount = votos reprocessados;
 * - mismatchCount = recibos divergentes, votos sem recibo ou recibos órfãos;
 * - ok = mismatchCount === 0.
 * A resposta NUNCA contém valores de voto (votação secreta: o recibo comprova
 * participação, sem correlação com o resultado).
 * Votação não encerrada → 409 (recibos existem apenas após o fechamento).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError, forbiddenRole } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadVoting } from '@/lib/server/loaders'
import { PERMISSIONS } from '@/lib/server/rbac'
import { computeReceipt, SECRET_VOTE_PLACEHOLDER } from '@/lib/server/receipts'
import type { ReceiptsVerificationView, VotingMode } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)

  // OR de permissões: auditoria (audit.read) OU mesa (voting.write)
  const allowed =
    (PERMISSIONS['audit.read'] ?? []).includes(actor.role) ||
    (PERMISSIONS['voting.write'] ?? []).includes(actor.role)
  if (!allowed) {
    throw forbiddenRole(
      `Papel "${actor.role}" não pode verificar recibos. Papéis permitidos: auditoria (audit.read) ou mesa diretora (voting.write).`
    )
  }

  const { id } = await ctx.params
  const voting = await loadVoting(actor, id)
  if (voting.status !== 'closed') {
    throw new DomainError(
      'VOTING_INVALID_TRANSITION',
      409,
      'Recibos indisponíveis',
      `Recibos verificáveis são emitidos apenas no encerramento da votação — status atual: "${voting.status}".`
    )
  }

  const tenantId = voting.session.tenantId
  const closedAtIso = voting.closedAt!.toISOString()
  const secret = voting.mode === 'secreto'

  const [votes, receipts, parliamentarians] = await Promise.all([
    db.vote.findMany({ where: { votingId: voting.id } }),
    db.voteReceipt.findMany({
      where: { votingId: voting.id },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    }),
    // VoteReceipt não tem relation com Parliamentarian (schema Task 27) — join manual
    db.parliamentarian.findMany({
      where: { tenantId },
      select: { id: true, name: true, order: true },
    }),
  ])

  const parlById = new Map(parliamentarians.map((p) => [p.id, p]))
  const receiptRows = receipts
    .map((r) => ({ receipt: r, parl: parlById.get(r.parliamentarianId) }))
    .sort((a, b) => (a.parl?.order ?? 999) - (b.parl?.order ?? 999) || a.receipt.issuedAt.getTime() - b.receipt.issuedAt.getTime())

  // Recomputa o HMAC de cada voto e compara com o recibo persistido
  const receiptByParl = new Map(receipts.map((r) => [r.parliamentarianId, r]))
  let mismatchCount = 0
  for (const vote of votes) {
    const valueForReceipt = secret ? SECRET_VOTE_PLACEHOLDER : vote.value
    const { code } = computeReceipt(tenantId, voting.id, vote.parliamentarianId, valueForReceipt, closedAtIso)
    const persisted = receiptByParl.get(vote.parliamentarianId)
    if (!persisted || persisted.receiptCode !== code) mismatchCount += 1
  }
  // Recibos órfãos (sem voto correspondente) também são divergência
  const voteIds = new Set(votes.map((v) => v.parliamentarianId))
  for (const r of receipts) {
    if (!voteIds.has(r.parliamentarianId)) mismatchCount += 1
  }

  const view: ReceiptsVerificationView = {
    ok: mismatchCount === 0,
    recomputedCount: votes.length,
    mismatchCount,
    mode: voting.mode as VotingMode,
    secret: false, // o segredo HMAC jamais sai do servidor
    receipts: receiptRows.map(({ receipt, parl }) => ({
      parliamentarianId: receipt.parliamentarianId,
      parliamentarianName: parl?.name ?? 'Parlamentar',
      receiptCode: receipt.receiptCode,
      issuedAt: receipt.issuedAt.toISOString(),
    })),
  }
  return Response.json(view)
})
