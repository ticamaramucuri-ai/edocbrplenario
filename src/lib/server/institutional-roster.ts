import type { Prisma, PrismaClient } from '@prisma/client'

type Client = Prisma.TransactionClient | PrismaClient

/** Datas de mandato/licença são civis e inclusivas no fuso da Câmara. */
function localDay(at: Date, timezone: string) {
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

/** ID dos titulares/suplentes aptos na data civil da sessão; o chamador filtra ativos. */
export async function institutionalRosterIds(client: Client, tenantId: string, sessionId: string) {
  const [tenant, session, mandates, leaves] = await Promise.all([
    client.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } }),
    client.session.findFirstOrThrow({ where: { id: sessionId, tenantId }, select: { scheduledAt: true } }),
    client.mandate.findMany({ where: { tenantId }, select: { parliamentarianId: true, startDate: true, endDate: true } }),
    client.leave.findMany({ where: { tenantId, kind: { in: ['licenca', 'afastamento'] } },
      select: { parliamentarianId: true, substituteId: true, startDate: true, endDate: true } }),
  ])
  const day = localDay(session.scheduledAt, tenant.timezone)
  const mandated = new Set(mandates.filter((row) => covers(day, row.startDate, row.endDate)).map((row) => row.parliamentarianId))
  const away = new Set<string>()
  const substitutes = new Set<string>()
  for (const leave of leaves) {
    if (!covers(day, leave.startDate, leave.endDate)) continue
    away.add(leave.parliamentarianId)
    if (leave.substituteId && mandated.has(leave.parliamentarianId)) substitutes.add(leave.substituteId)
  }
  return new Set([...mandated, ...substitutes].filter((id) => !away.has(id)))
}
