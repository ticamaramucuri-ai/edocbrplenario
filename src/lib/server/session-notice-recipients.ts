import type { Prisma } from '@prisma/client'

/** Congela os destinatários ativos no instante da emissão da revisão. */
export async function snapshotNoticeRecipients(tx: Prisma.TransactionClient, input: {
  tenantId: string
  sessionId: string
  revision: number
  noticeSha256: string
  issuedAt: Date
}) {
  const parliamentarians = await tx.parliamentarian.findMany({
    where: { tenantId: input.tenantId, active: true },
    select: { id: true, name: true },
  })
  if (parliamentarians.length === 0) return
  await tx.sessionNoticeRecipient.createMany({
    data: parliamentarians.map((person) => ({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      revision: input.revision,
      parliamentarianId: person.id,
      recipientName: person.name,
      noticeSha256: input.noticeSha256,
      issuedAt: input.issuedAt,
    })),
  })
}
