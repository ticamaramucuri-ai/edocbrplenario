import type { Prisma } from '@prisma/client'
import { tenantSettings } from './domain'
import { DomainError } from './errors'
import { institutionalRosterIds } from './institutional-roster'

/** Calcula o universo institucional antes de congelar cada revisão. */
export async function eligibleNoticeRecipients(tx: Prisma.TransactionClient, tenantId: string, sessionId: string) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })
  const people = await tx.parliamentarian.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } })
  if (tenantSettings(tenant).noticeRecipientPolicy === 'active') return people
  const roster = await institutionalRosterIds(tx, tenantId, sessionId)
  return people.filter((person) => roster.has(person.id))
}

/** Congela os destinatários da política vigente no instante da emissão da revisão. */
export async function snapshotNoticeRecipients(tx: Prisma.TransactionClient, input: {
  tenantId: string
  sessionId: string
  revision: number
  noticeSha256: string
  issuedAt: Date
}) {
  const parliamentarians = await eligibleNoticeRecipients(tx, input.tenantId, input.sessionId)
  if (parliamentarians.length === 0) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { settings: true } })
    if (tenantSettings(tenant).noticeRecipientPolicy === 'mandate_and_leave') {
      throw new DomainError('SESSION_PRECONDITION', 409, 'Destinatários não cadastrados',
        'Nenhum parlamentar com mandato vigente ou suplência registrada foi encontrado para a data da sessão. Revise os cadastros antes de publicar.')
    }
    return
  }
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
