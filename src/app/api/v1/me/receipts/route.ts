/**
 * GET /api/v1/me/receipts — recibos verificáveis do PRÓPRIO parlamentar
 * (Fase 18/ADR-019, App do Parlamentar). RBAC: self.vote (parlamentar
 * vinculado). Join com a votação para pergunta/modo/encerramento; o código é
 * apresentado em fonte mono no app para conferência manual com a auditoria.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireMeParliamentarian } from '@/lib/server/me'
import type { MyVoteReceiptRow } from '@/lib/api-client'
import type { VotingMode } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'self.vote')
  const parliamentarian = await requireMeParliamentarian(actor)

  const receipts = await db.voteReceipt.findMany({
    where: { parliamentarianId: parliamentarian.id },
    include: { voting: { select: { question: true, mode: true, closedAt: true } } },
    orderBy: { issuedAt: 'desc' },
    take: 60,
  })

  const rows: MyVoteReceiptRow[] = receipts.map((r) => ({
    id: r.id,
    votingId: r.votingId,
    question: r.voting.question,
    mode: r.voting.mode as VotingMode,
    closedAt: r.voting.closedAt ? r.voting.closedAt.toISOString() : r.issuedAt.toISOString(),
    receiptCode: r.receiptCode,
    issuedAt: r.issuedAt.toISOString(),
  }))

  return Response.json({ receipts: rows })
})
