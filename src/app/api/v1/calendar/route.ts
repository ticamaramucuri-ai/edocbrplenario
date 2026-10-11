/**
 * GET /api/v1/calendar?year=&month= (Fase 13) — Agenda Legislativa.
 * Agregação somente-leitura dos eventos do mês [início do mês, início do
 * mês seguinte) no escopo do tenant do ator:
 * - Session (todas, qualquer status)          → kind 'session'
 * - PublicHearing (status != canceled)         → kind 'hearing'
 * - CommitteeMeeting (status != cancelada)     → kind 'committee_meeting'
 * - LegislativeTask (APENAS pendente)          → kind 'task_deadline'
 * RBAC: leitura liberada para qualquer papel autenticado (escopo derivado
 * server-side); nenhum dado de outro tenant é retornado.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { SESSION_TYPE_LABEL, type CalendarEventView, type CalendarResponse } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  year: z.coerce
    .number()
    .int('Ano deve ser um número inteiro.')
    .min(2020, 'Ano deve estar entre 2020 e 2035.')
    .max(2035, 'Ano deve estar entre 2020 e 2035.')
    .optional(),
  month: z.coerce
    .number()
    .int('Mês deve ser um número inteiro.')
    .min(1, 'Mês deve estar entre 1 e 12.')
    .max(12, 'Mês deve estar entre 1 e 12.')
    .optional(),
})

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)

  const params = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()))
  const now = new Date()
  const year = params.year ?? now.getUTCFullYear()
  const month = params.month ?? now.getUTCMonth() + 1

  // Janela do mês em UTC — coerente com o fuso institucional (America/Sao_Paulo)
  // usado no seed (wall-clock persistido) e com a exibição do cliente.
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
      // Prazos concluídos/cancelados NÃO poluem a agenda (critério de aceite).
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

  const body: CalendarResponse = { year, month, events }
  return Response.json(body)
})
