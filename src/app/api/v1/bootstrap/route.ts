/**
 * GET /api/v1/bootstrap — primeira chamada do frontend.
 * Sem x-actor-id: retorna tenant default + atores para a seleção de perfil
 * (ponto de entrada da demonstração — ver ADR-005). Com ator: escopo do ator.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveTenantScope, tryResolveActor } from '@/lib/server/actor'
import { demoModeEnabled } from '@/lib/server/demo-mode'
import { buildSessionSummaries, toActorView, toTenantView } from '@/lib/server/serializers'
import { defaultTenant } from '@/lib/server/default-tenant'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await tryResolveActor(req)
  const demoMode = demoModeEnabled()
  const tenantId = actor ? await resolveTenantScope(req, actor) : await defaultTenantId(req)

  const [tenant, users, tenantUserCount, parliamentarianCount, matterCount, sessionCount] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId } }),
    !actor && !demoMode ? Promise.resolve([]) : db.user.findMany({
      where: {
        ...(demoMode
          ? { OR: [
              { tenantId, active: true },
              { tenantId: null, active: true, role: { in: ['platform_owner', 'platform_support'] } },
            ] }
          : { id: actor?.id }),
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }),
    db.user.count({ where: { tenantId, active: true } }),
    db.parliamentarian.count({ where: { tenantId, active: true } }),
    db.legislativeMatter.count({ where: { tenantId } }),
    db.session.count({ where: { tenantId } }),
  ])
  if (!tenant) throw notFound('Câmara não encontrada.')

  const now = new Date()
  const [nextSessionRaw, liveSessionRaw] = await Promise.all([
    db.session.findFirst({
      where: { tenantId, status: 'scheduled', scheduledAt: { gte: now } },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.session.findFirst({
      where: { tenantId, status: { in: ['check_in', 'open', 'suspended', 'resumed'] } },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const [nextSession] = nextSessionRaw
    ? await buildSessionSummaries(db, tenantId, [nextSessionRaw])
    : [null]
  const [liveSession] = liveSessionRaw
    ? await buildSessionSummaries(db, tenantId, [liveSessionRaw])
    : [null]

  return Response.json({
    tenant: toTenantView(tenant, parliamentarianCount),
    demoMode,
    actors: users.map(toActorView),
    // Mucuri está cadastrada sem usuários: sem este motivo a tela de entrada
    // mostrava só os atores de plataforma e não explicava a ausência. Segue a
    // mesma condição de counts e das sessões — chamador anônimo em produção não
    // precisa saber que a Câmara está sem usuário ativo.
    actorsEmptyReason:
      (actor || demoMode) && tenantUserCount === 0 ? 'tenant_sem_usuarios' : null,
    counts: {
      parliamentarians: actor || demoMode ? parliamentarianCount : 0,
      matters: actor || demoMode ? matterCount : 0,
      sessions: actor || demoMode ? sessionCount : 0,
    },
    nextSession: actor || demoMode ? nextSession : null,
    liveSession: actor || demoMode ? liveSession : null,
  })
})

async function defaultTenantId(req: Request): Promise<string> {
  const slug = new URL(req.url).searchParams.get('tenant')
  if (slug) {
    const tenant = await db.tenant.findUnique({ where: { slug } })
    if (tenant?.active) return tenant.id
  }
  const first = await defaultTenant()
  if (!first) throw notFound('Nenhum tenant ativo na plataforma.')
  return first.id
}
