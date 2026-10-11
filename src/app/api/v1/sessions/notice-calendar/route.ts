/** Prazos operacionais de convocação e retificação das próximas sessões. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { tenantSettings } from '@/lib/server/domain'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const tenantId = await resolveTenantScope(req, actor)
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw notFound('Câmara não encontrada.')
  const policy = tenantSettings(tenant)
  const now = new Date()
  const sessions = await db.session.findMany({
    where: { tenantId, status: { in: ['draft', 'scheduled'] }, scheduledAt: { gt: now } },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 50,
  })
  const rows = sessions.map((session) => {
    const phase = session.status === 'draft' ? 'initial' : 'amendment'
    const minimumHours = phase === 'initial' ? policy.minimumNoticeHours : policy.minimumAmendmentHours
    const deadlineAt = new Date(session.scheduledAt.getTime() - minimumHours * 60 * 60 * 1000)
    const remainingMs = deadlineAt.getTime() - now.getTime()
    return {
      sessionId: session.id, number: session.number, year: session.year, type: session.type,
      phase, scheduledAt: session.scheduledAt.toISOString(), deadlineAt: deadlineAt.toISOString(),
      minimumHours, state: remainingMs < 0 ? 'passed' : remainingMs <= 24 * 60 * 60 * 1000 ? 'due_soon' : 'on_time',
      exceptionAllowed: policy.urgentNoticeExceptionTypes.includes(session.type as typeof policy.urgentNoticeExceptionTypes[number]),
    }
  }).sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt) || a.sessionId.localeCompare(b.sessionId))
  return Response.json({ timezone: tenant.timezone, generatedAt: now.toISOString(), rows },
    { headers: { 'Cache-Control': 'no-store' } })
})
