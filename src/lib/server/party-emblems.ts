import type { Prisma } from '@prisma/client'

/** Party is authoritative; Parliamentarian.partyEmblemUrl is a display snapshot for existing readers. */
export async function setPartyEmblem(tx: Prisma.TransactionClient, tenantId: string, acronym: string, emblemUrl: string | null) {
  const party = await tx.party.upsert({
    where: { tenantId_acronym: { tenantId, acronym } },
    create: { tenantId, acronym, name: acronym, emblemUrl },
    update: { emblemUrl },
  })
  await tx.parliamentarian.updateMany({ where: { tenantId, party: acronym }, data: { partyEmblemUrl: emblemUrl } })
  return party
}

export async function partyEmblem(tx: Prisma.TransactionClient, tenantId: string, acronym: string): Promise<string | null> {
  const party = await tx.party.findUnique({ where: { tenantId_acronym: { tenantId, acronym } }, select: { emblemUrl: true } })
  return party?.emblemUrl ?? null
}
