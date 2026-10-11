import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from './tx'
import { tenantSettings } from './domain'
import { noticeDeadline } from './notice-deadline'
import { notify } from './notify'

const HOUR_MS = 60 * 60 * 1000
const MAX_HORIZON_MS = (720 + 168) * HOUR_MS
const TARGET_ROLES = ['tenant_admin', 'session_operator'] as const

/** Varredura reexecutável: aviso prévio e aviso de prazo vencido, por revisão de prazo e papel. */
export async function scanNoticeDeadlineAlerts(now = new Date()) {
  const tenants = await db.tenant.findMany({ where: { active: true },
    select: { id: true, name: true, settings: true, timezone: true } })
  let due = 0
  let created = 0
  for (const tenant of tenants) {
    const policy = tenantSettings(tenant)
    const sessions = await db.session.findMany({ where: {
      tenantId: tenant.id, status: { in: ['draft', 'scheduled'] },
      scheduledAt: { gt: now, lte: new Date(now.getTime() + MAX_HORIZON_MS) },
    }, orderBy: { scheduledAt: 'asc' } })
    for (const session of sessions) {
      const deadline = noticeDeadline(session, policy)
      const remainingMs = deadline.deadlineAt.getTime() - now.getTime()
      if (remainingMs > policy.noticeAlertLeadHours * HOUR_MS) continue
      due++
      const state = remainingMs <= 0 ? 'overdue' : 'upcoming'
      const action = deadline.phase === 'initial' ? 'publicação da convocação' : 'retificação da pauta'
      let time: string
      try {
        time = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short',
          timeZone: tenant.timezone }).format(deadline.deadlineAt)
      } catch {
        time = deadline.deadlineAt.toISOString()
      }
      const title = state === 'overdue' ? `Prazo vencido: sessão ${session.number}/${session.year}` :
        `Prazo próximo: sessão ${session.number}/${session.year}`
      const body = `O prazo de ${action} da sessão ${session.number}/${session.year} é ${time} (${tenant.timezone}). ${state === 'overdue' ? 'Verifique a política de urgência antes de agir.' : 'Revise a pauta e publique dentro do prazo.'}`
      for (const role of TARGET_ROLES) {
        const dedupeKey = `notice-deadline:${session.id}:${deadline.phase}:${session.scheduledAt.getTime()}:${deadline.deadlineAt.getTime()}:${state}:${role}`
        try {
          const inserted = await withTransaction(async (tx) => {
            const existing = await tx.notification.findUnique({ where: { tenantId_dedupeKey: { tenantId: tenant.id, dedupeKey } } })
            if (existing) return false
            await notify(tx, { tenantId: tenant.id, title, body, kind: 'session', module: 'sessions',
              targetRole: role, dedupeKey })
            return true
          })
          if (inserted) created++
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
          throw error
        }
      }
    }
  }
  return { tenants: tenants.length, due, created }
}
