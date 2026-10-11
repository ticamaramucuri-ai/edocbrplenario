import type { Prisma, PrismaClient, Voting } from '@prisma/client'
import type { VotingBasisReportView } from '@/lib/contracts'

type Client = Prisma.TransactionClient | PrismaClient

/** Resumo da base congelada; motivo visível apenas quando o papel permite. */
export async function loadVotingBases(
  client: Client,
  votings: Voting[],
  includeReasons: boolean
): Promise<Record<string, VotingBasisReportView>> {
  if (votings.length === 0) return {}
  const impediments = await client.votingImpediment.findMany({
    where: { votingId: { in: votings.map((v) => v.id) }, revokedAt: null },
    include: { parliamentarian: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const byVoting = new Map<string, VotingBasisReportView['impediments']>()
  for (const row of impediments) {
    const list = byVoting.get(row.votingId) ?? []
    list.push({ parliamentarianId: row.parliamentarianId, name: row.parliamentarian.name,
      reason: includeReasons ? row.reason : null })
    byVoting.set(row.votingId, list)
  }
  return Object.fromEntries(votings.map((v) => [v.id, {
    presentAtOpen: v.presentAtOpen,
    presentAtClose: v.presentAtClose,
    requiredQuorum: v.quorumAtOpen ?? v.requiredQuorum,
    memberBaseAtOpen: v.memberBaseAtOpen,
    impedimentPolicyAtOpen: v.impedimentPolicyAtOpen === 'retain_base' || v.impedimentPolicyAtOpen === 'reduce_base'
      ? v.impedimentPolicyAtOpen : null,
    impediments: byVoting.get(v.id) ?? [],
  } satisfies VotingBasisReportView]))
}
