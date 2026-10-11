/**
 * POST /api/v1/platform/schedules/:id/run — execução MANUAL e imediata de um
 * agendamento (Onda 5 / Fase 21). RBAC `platform.manage` (somente
 * platform_owner).
 *
 * Fluxo: chama o mini-serviço scheduler via HTTP interno
 * (`POST http://localhost:3005/jobs/{kind}/run`, timeout 10s) e grava o
 * resultado na LINHA do job: `lastRunAt=agora`, `lastStatus`/`lastNote` do
 * resultado, `updatedBy=ator.name`, `updatedAt=agora`.
 *
 * CRÍTICO (critério de aceite da F21): a execução manual **NUNCA altera
 * `nextRunAt`** — rodar agora não adianta a agenda; o próximo tick agendado
 * permanece exatamente onde estava (quem recalcula nextRunAt é apenas o tick
 * de 30s do próprio scheduler, após execuções agendadas).
 *
 * Casos:
 *  - scheduler fora do ar / timeout / resposta não-2xx → 503
 *    SCHEDULER_UNAVAILABLE (schedulerUnavailable());
 *  - job inativo → o kind é executado mesmo assim (informativo), mas a linha
 *    registra `lastStatus='skipped'` + nota "Job pausado — execução manual
 *    informativa.";
 *  - job inexistente → 404.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound, schedulerUnavailable } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { toScheduledJobView } from '../../serialize'

export const dynamic = 'force-dynamic'

const SCHEDULER_BASE_URL = 'http://localhost:3005'
const RUN_TIMEOUT_MS = 10_000

type SchedulerRunResult = { status: string; note: string }

/** HTTP interno ao scheduler com timeout curto; falha de rede → 503. */
async function callSchedulerRun(kind: string): Promise<SchedulerRunResult> {
  let res: Response
  try {
    res = await fetch(`${SCHEDULER_BASE_URL}/jobs/${kind}/run`, {
      method: 'POST',
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    // Conexão recusada / timeout de 10s / DNS — scheduler fora do ar.
    throw schedulerUnavailable()
  }
  if (!res.ok) {
    throw schedulerUnavailable(
      `Serviço de agendamentos respondeu HTTP ${res.status} ao executar "${kind}".`
    )
  }
  const body = (await res.json().catch(() => null)) as SchedulerRunResult | null
  if (!body || typeof body.status !== 'string' || typeof body.note !== 'string') {
    throw schedulerUnavailable('Resposta inesperada do scheduler ao executar o job.')
  }
  return body
}

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, _correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')

    const { id } = await ctx.params
    const job = await db.scheduledJob.findUnique({ where: { id } })
    if (!job) throw notFound('Agendamento não encontrado.')

    // Executa o kind IMEDIATAMENTE no scheduler (HTTP interno, timeout 10s).
    const result = await callSchedulerRun(job.kind)

    // Job pausado: execução manual é informativa — grava 'skipped' na linha
    // (o kind rodou, mas o agendamento segue pausado para o tick de 30s).
    const effective: SchedulerRunResult = job.active
      ? result
      : { status: 'skipped', note: 'Job pausado — execução manual informativa.' }

    const now = new Date()
    const updated = await db.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastRunAt: now,
        lastStatus: effective.status,
        lastNote: effective.note,
        updatedBy: actor.name,
        updatedAt: now,
        // nextRunAt INTENCIONALMENTE não tocado — execução manual não adianta a agenda.
      },
    })

    return Response.json({ job: toScheduledJobView(updated) })
  }
)
