import type { Prisma } from '@prisma/client'
import { tenantSettings } from './domain'
import { DomainError } from './errors'

/** Data civil da sessão no fuso da Câmara; mandatos usam datas ISO sem hora. */
function sessionDay(at: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
    const value = (part: string) => parts.find((item) => item.type === part)?.value
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

function covers(day: string, start: Date, end: Date | null) {
  return start.toISOString().slice(0, 10) <= day && (!end || end.toISOString().slice(0, 10) >= day)
}

/** Calcula o universo institucional antes de congelar cada revisão. */
export async function eligibleNoticeRecipients(tx: Prisma.TransactionClient, tenantId: string, sessionId: string) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true, timezone: true } })
  const session = await tx.session.findFirstOrThrow({ where: { id: sessionId, tenantId }, select: { scheduledAt: true } })
  const people = await tx.parliamentarian.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } })
  if (tenantSettings(tenant).noticeRecipientPolicy === 'active') return people

  const day = sessionDay(session.scheduledAt, tenant.timezone)
  const [mandates, leaves] = await Promise.all([
    tx.mandate.findMany({ where: { tenantId }, select: { parliamentarianId: true, startDate: true, endDate: true } }),
    tx.leave.findMany({ where: { tenantId, kind: { in: ['licenca', 'afastamento'] } },
      select: { parliamentarianId: true, substituteId: true, startDate: true, endDate: true } }),
  ])
  const mandated = new Set(mandates.filter((row) => covers(day, row.startDate, row.endDate)).map((row) => row.parliamentarianId))
  const away = new Set<string>()
  const substitutes = new Set<string>()
  for (const leave of leaves) {
    if (!covers(day, leave.startDate, leave.endDate)) continue
    away.add(leave.parliamentarianId)
    if (leave.substituteId && mandated.has(leave.parliamentarianId)) substitutes.add(leave.substituteId)
  }
  return people.filter((person) => !away.has(person.id) && (mandated.has(person.id) || substitutes.has(person.id)))
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
