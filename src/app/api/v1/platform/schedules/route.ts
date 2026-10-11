/**
 * GET /api/v1/platform/schedules — lista os agendamentos da plataforma
 * (Onda 5 / Fase 21 — ROADMAP §12.1). RBAC `platform.read` (platform_owner e
 * platform_support: o suporte precisa enxergar a operação; mutações seguem
 * exclusivas do owner em /platform/schedules/:id e /:id/run).
 *
 * Retorna `{ jobs: ScheduledJobView[] }` (ordem de criação — estável) com
 * `nextRunAt`, `lastRunAt`, `lastStatus`, `lastNote`, `active`, `updatedBy`.
 * As linhas são mantidas pelo mini-serviço scheduler :3005 (tick de 30s) e
 * pelas rotas de execução manual — leitura pura, sem efeitos colaterais.
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toScheduledJobView } from './serialize'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  const jobs = await db.scheduledJob.findMany({ orderBy: { createdAt: 'asc' } })
  return Response.json({ jobs: jobs.map(toScheduledJobView) })
})
