/**
 * GET /api/v1/external/calendar — eventos do calendário legislativo do tenant
 * da chave (Fase 23, ADR-024). Bearer `legk_…` (escopo calendar.read) OU
 * delegação `deleg_…` do playground. Rate limit 60 req/min por chave.
 *
 * Mesma agregação da rota interna /api/v1/calendar (Fase 13) — sessões,
 * audiências públicas, reuniões de comissão e prazos de tarefas pendentes —
 * porém SEMPRE no escopo do tenant da CHAVE (nunca do ator). Parâmetros
 * ?year=&month= (default: mês corrente UTC) + paginação ?page=1&pageSize=20
 * (máx 50) aplicada sobre a lista agregada ordenada por data; envelope
 * { data, page, pageSize, total }.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { SESSION_TYPE_LABEL, type CalendarEventView } from '@/lib/contracts'
import { parseExternalPagination, resolveExternalAuth } from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const authResult = await resolveExternalAuth(req, correlationId, 'calendar.read')
  if (!authResult.ok) return authResult.error
  const { tenantId } = authResult.auth

  const params = req.nextUrl.searchParams
  const { page, pageSize } = parseExternalPagination(params)
  const now = new Date()
  const yearRaw = params.get('year')?.trim()
  const monthRaw = params.get('month')?.trim()
  const year = yearRaw && !Number.isNaN(parseInt(yearRaw, 10)) ? parseInt(yearRaw, 10) : now.getUTCFullYear()
  const month =
    monthRaw && !Number.isNaN(parseInt(monthRaw, 10)) ? parseInt(monthRaw, 10) : now.getUTCMonth() + 1

  // Janela do mês em UTC — coerente com a rota interna /api/v1/calendar.
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const [sessions, hearings, meetings, tasks] = await Promise.all([
    db.session.findMany({
      where: { tenantId, scheduledAt: { gte: start, lt: end } },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.publicHearing.findMany({
      where: { tenantId, status: { not: 'canceled' }, scheduledAt: { gte: start, lt: end } },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.committeeMeeting.findMany({
      where: { committee: { tenantId }, status: { not: 'cancelada' }, scheduledAt: { gte: start, lt: end } },
      include: { committee: true },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.legislativeTask.findMany({
      where: { tenantId, status: 'pendente', dueAt: { gte: start, lt: end } },
      orderBy: { dueAt: 'asc' },
    }),
  ])

  const events: CalendarEventView[] = [
    ...sessions.map((s) => ({
      id: s.id,
      kind: 'session' as const,
      title: `${SESSION_TYPE_LABEL[s.type as keyof typeof SESSION_TYPE_LABEL] ?? s.type} nº ${s.number}/${s.year}`,
      date: s.scheduledAt.toISOString(),
      status: s.status,
      meta: s.location || null,
      module: 'sessions',
    })),
    ...hearings.map((h) => ({
      id: h.id,
      kind: 'hearing' as const,
      title: h.title,
      date: h.scheduledAt.toISOString(),
      status: h.status,
      meta: h.location || null,
      module: 'publications',
    })),
    ...meetings.map((m) => ({
      id: m.id,
      kind: 'committee_meeting' as const,
      title: `${m.committee.name} — ${m.subject}`,
      date: m.scheduledAt.toISOString(),
      status: m.status,
      meta: m.committee.acronym || null,
      module: 'structure',
    })),
    ...tasks.map((t) => ({
      id: t.id,
      kind: 'task_deadline' as const,
      title: t.title,
      date: t.dueAt.toISOString(),
      status: t.status,
      meta: t.assigneeName || null,
      module: 'workflow',
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const total = events.length
  const data = events.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

  return Response.json({ data, page, pageSize, total, year, month })
})
