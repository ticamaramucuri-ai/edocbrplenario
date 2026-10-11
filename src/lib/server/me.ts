/**
 * Helpers do App do Parlamentar (Fase 7 — rotas /api/v1/me/*).
 * O ator DEVE ter papel parliamentarian COM parliamentarianId vinculado;
 * a sessão-alvo segue a MESMA regra do public/live (em andamento > próxima
 * agendada > última encerrada).
 */
import { db } from '@/lib/db'
import { forbiddenRole } from './errors'
import type { ResolvedActor } from './actor'
import type { Parliamentarian, Session } from '@prisma/client'
import type { AttendanceStatus } from '@/lib/contracts'

/** 403 claro quando o ator não é parlamentar vinculado. */
export async function requireMeParliamentarian(actor: ResolvedActor): Promise<Parliamentarian> {
  if (actor.role !== 'parliamentarian' || !actor.parliamentarianId) {
    throw forbiddenRole(
      'O App do Parlamentar exige um ator com papel "parliamentarian" e vínculo com um parlamentar. Troque o perfil de acesso no menu do topo.'
    )
  }
  const parliamentarian = await db.parliamentarian.findUnique({ where: { id: actor.parliamentarianId } })
  if (!parliamentarian || parliamentarian.tenantId !== actor.tenantId || !parliamentarian.active) {
    throw forbiddenRole(
      'Parlamentar vinculado ao ator não encontrado (ou inativo) neste tenant. Contate a administração da Câmara.'
    )
  }
  return parliamentarian
}

const LIVE_STATUSES = ['check_in', 'open', 'suspended', 'resumed']

/**
 * Sessão-alvo do app: em andamento (mais recente) > próxima agendada >
 * última encerrada — idêntico ao /public/live.
 */
export async function targetSessionForTenant(tenantId: string): Promise<Session | null> {
  const now = new Date()
  const live = await db.session.findFirst({
    where: { tenantId, status: { in: LIVE_STATUSES } },
    orderBy: { updatedAt: 'desc' },
  })
  if (live) return live
  const next = await db.session.findFirst({
    where: { tenantId, status: 'scheduled', scheduledAt: { gte: now } },
    orderBy: { scheduledAt: 'asc' },
  })
  if (next) return next
  return db.session.findFirst({
    where: { tenantId, status: 'closed' },
    orderBy: { closedAt: 'desc' },
  })
}

/** Estado de presença consolidado de um parlamentar numa sessão. */
export function attendanceStatusOf(
  events: Array<{ parliamentarianId: string; status: string; createdAt: Date }>,
  parliamentarianId: string
): { status: AttendanceStatus; lastEventAt: string | null } {
  const mine = events
    .filter((e) => e.parliamentarianId === parliamentarianId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const last = mine[mine.length - 1]
  return {
    status: (last?.status as AttendanceStatus) ?? 'ausente',
    lastEventAt: last ? last.createdAt.toISOString() : null,
  }
}
