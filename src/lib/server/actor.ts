/**
 * Resolução do ator e escopo de tenant.
 * ADR-005: nenhum endpoint confia em tenantId/role vindos do cliente.
 *
 * Fase 9 (autenticação real): a resolução tenta PRIMEIRO o cookie de sessão
 * `legis_session` (login por e-mail/senha, httpOnly); sem sessão válida, cai
 * no modo demo via header `x-actor-id` — os dois convivem. Tenant desativado
 * bloqueia papéis com escopo de tenant (TENANT_INACTIVE).
 *
 * Onda 5 / Fase 24 — bloqueio SUAVE de trial expirado: após validar o tenant
 * ativo, um ator NÃO-platform com tenant cujo `trialEndsAt` venceu só pode
 * LER (GET/HEAD seguem liberados); métodos de ESCRITA (POST/PUT/PATCH/DELETE)
 * recebem 403 TRIAL_EXPIRED com a data de expiração. O bloqueio é centralizado
 * AQUI (todas as rotas passam por resolveActor) e nunca atinge papéis
 * platform_* nem o login (a rota de login não passa por resolveActor).
 */
import { db } from '@/lib/db'
import { defaultTenant } from './default-tenant'
import type { Role } from '@/lib/contracts'
import {
  unauthenticated,
  forbiddenTenant,
  forbiddenRole,
  forbiddenTenantInactive,
  notFound,
  trialExpired,
} from './errors'
import { getSessionToken, resolveSessionToken } from './session'
import { demoModeEnabled } from './demo-mode'

// isPlatform concede escopo global de Câmara. O monitor autentica sem tenant,
// mas não recebe esse escopo: sua única permissão é system.status.read.
const PLATFORM_ROLES: Role[] = ['platform_owner', 'platform_support']
const TENANTLESS_ROLES: Role[] = [...PLATFORM_ROLES, 'platform_monitor']

function enforceMonitorEndpoint(req: Request, actor: ResolvedActor): void {
  if (actor.role === 'platform_monitor' &&
      new URL(req.url).pathname !== '/api/v1/platform/system-status') {
    throw forbiddenRole('O monitor só acessa o estado operacional da plataforma.')
  }
}

/** Métodos que MUTAM estado — único caso bloqueado pelo trial vencido. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type ResolvedActor = {
  id: string
  name: string
  role: Role
  jobTitle: string | null
  tenantId: string | null
  parliamentarianId: string | null
  /** Papéis platform_* têm escopo global (ignoram escopo de tenant). */
  isPlatform: boolean
}

/** Campos de User usados na montagem do ator (aceita qualquer include). */
type UserLike = {
  id: string
  name: string
  role: string
  jobTitle: string | null
  tenantId: string | null
  parliamentarianId: string | null
}

function toActor(user: UserLike): ResolvedActor {
  const role = user.role as Role
  const isPlatform = PLATFORM_ROLES.includes(role)
  return {
    id: user.id,
    name: user.name,
    role,
    jobTitle: user.jobTitle ?? null,
    tenantId: user.tenantId ?? null,
    parliamentarianId: user.parliamentarianId ?? null,
    isPlatform,
  }
}

/** Estado do tenant usado na resolução (tenant inexistente não bloqueia — dangling ref). */
async function tenantState(
  tenantId: string
): Promise<{ active: boolean; trialEndsAt: Date | null }> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { active: true, trialEndsAt: true },
  })
  return tenant ? { active: tenant.active, trialEndsAt: tenant.trialEndsAt } : { active: true, trialEndsAt: null }
}

/**
 * F24 — trial expirado bloqueia ESCRITA de atores com escopo de tenant.
 * Papéis platform_* e LEITURAS (GET/HEAD) nunca são bloqueados.
 */
function isExpiredTrialWrite(actor: ResolvedActor, req: Request, trialEndsAt: Date | null): boolean {
  return (
    !actor.isPlatform &&
    actor.tenantId !== null &&
    trialEndsAt !== null &&
    trialEndsAt.getTime() < Date.now() &&
    WRITE_METHODS.has(req.method.toUpperCase())
  )
}

/** 403 TRIAL_EXPIRED com a data do vencimento (leitura segue liberada). */
function expiredTrialProblem(trialEndsAt: Date): ReturnType<typeof trialExpired> {
  return trialExpired(
    `Trial expirado em ${trialEndsAt.toLocaleDateString('pt-BR')}. ` +
      'A leitura permanece liberada; a gravação foi bloqueada. Fale com a plataforma para reativar.'
  )
}

/**
 * Ator a partir do cookie de sessão (Fase 9). Devolve null quando não há
 * cookie, a sessão é inválida/revogada/expirada ou o usuário não monta um
 * ator válido — o chamador então tenta o modo demo (x-actor-id).
 */
async function actorFromSession(req: Request): Promise<ResolvedActor | null> {
  const token = getSessionToken(req)
  if (!token) return null
  const resolved = await resolveSessionToken(token)
  if (!resolved) return null
  const actor = toActor(resolved.user)
  if (!TENANTLESS_ROLES.includes(actor.role) && !actor.tenantId) return null
  return actor
}

/** Lê a sessão (ou o header demo) e resolve o User no banco. Sem nenhum → 401. */
export async function resolveActor(req: Request): Promise<ResolvedActor> {
  // 1) Autenticação real: cookie de sessão httpOnly (Fase 9) — tem prioridade.
  const sessionActor = await actorFromSession(req)
  if (sessionActor) {
    enforceMonitorEndpoint(req, sessionActor)
    if (!sessionActor.isPlatform && sessionActor.tenantId) {
      const state = await tenantState(sessionActor.tenantId)
      if (!state.active) {
        throw forbiddenTenantInactive(
          'Este tenant está desativado. Contate o operador da plataforma para reativá-lo.'
        )
      }
      if (isExpiredTrialWrite(sessionActor, req, state.trialEndsAt)) {
        throw expiredTrialProblem(state.trialEndsAt as Date)
      }
    }
    return sessionActor
  }

  if (!demoModeEnabled()) {
    throw unauthenticated('Entre com e-mail e senha para acessar o sistema.')
  }

  // 2) Modo demo: header x-actor-id (ADR-005) — fluxo original intacto.
  const id = req.headers.get('x-actor-id')
  if (!id || !id.trim()) {
    throw unauthenticated('Header x-actor-id ausente. Informe o ator demo (ver docs/adr/ADR-005).')
  }
  const user = await db.user.findUnique({
    where: { id: id.trim() },
    include: { parliamentarian: true },
  })
  if (!user || !user.active) {
    throw unauthenticated('Ator demo não encontrado ou inativo (header x-actor-id).')
  }
  const actor = toActor(user)
  enforceMonitorEndpoint(req, actor)
  if (!TENANTLESS_ROLES.includes(actor.role) && !actor.tenantId) {
    throw forbiddenTenant('Ator sem vínculo com um tenant.')
  }
  if (user.tenantId) {
    const state = await tenantState(user.tenantId)
    if (!state.active) {
      throw forbiddenTenantInactive(
        'Este tenant está desativado. Contate o operador da plataforma para reativá-lo.'
      )
    }
    if (isExpiredTrialWrite(actor, req, state.trialEndsAt)) {
      throw expiredTrialProblem(state.trialEndsAt as Date)
    }
  }
  return actor
}

/**
 * Escopo de dados do ator: platform_* usa `?tenant=slug` (default: primeiro
 * tenant ativo); demais papéis usam SEMPRE actor.tenantId.
 */
export async function resolveTenantScope(
  req: Request,
  actor: ResolvedActor
): Promise<string> {
  if (actor.role === 'platform_monitor') throw forbiddenTenant('Monitor não acessa dados de Câmara.')
  if (!actor.isPlatform) return actor.tenantId as string
  const slug = new URL(req.url).searchParams.get('tenant')
  if (slug) {
    const tenant = await db.tenant.findUnique({ where: { slug } })
    if (!tenant || !tenant.active) throw notFound(`Tenant "${slug}" não encontrado.`)
    return tenant.id
  }
  const first = await defaultTenant()
  if (!first) throw notFound('Nenhum tenant ativo na plataforma.')
  return first.id
}

/** Igual a resolveActor, mas devolve null em vez de lançar (ponto de entrada bootstrap). */
export async function tryResolveActor(req: Request): Promise<ResolvedActor | null> {
  // 1) Autenticação real: cookie de sessão httpOnly (Fase 9).
  const sessionActor = await actorFromSession(req)
  if (sessionActor) {
    if (!sessionActor.isPlatform && sessionActor.tenantId) {
      const state = await tenantState(sessionActor.tenantId)
      if (!state.active) return null
      // F24 — escrita em tenant com trial vencido: trata como não autenticado
      // (o chamador é leitura de bootstrap; o POST real usa resolveActor e
      // recebe o 403 TRIAL_EXPIRED detalhado).
      if (isExpiredTrialWrite(sessionActor, req, state.trialEndsAt)) return null
    }
    return sessionActor
  }

  if (!demoModeEnabled()) return null

  // 2) Modo demo: header x-actor-id (ADR-005) — fluxo original intacto.
  const id = req.headers.get('x-actor-id')
  if (!id || !id.trim()) return null
  const user = await db.user.findUnique({
    where: { id: id.trim() },
    include: { parliamentarian: true },
  })
  if (!user || !user.active) return null
  const actor = toActor(user)
  if (!TENANTLESS_ROLES.includes(actor.role) && !actor.tenantId) return null
  if (user.tenantId) {
    const state = await tenantState(user.tenantId)
    if (!state.active) return null
    if (isExpiredTrialWrite(actor, req, state.trialEndsAt)) return null
  }
  return actor
}

/** Garante que o ator pode acessar recurso de outro tenant (403 se não puder). */
export function assertTenantScope(actor: ResolvedActor, resourceTenantId: string): void {
  if (actor.isPlatform) return
  if (actor.tenantId !== resourceTenantId) {
    throw forbiddenTenant('Recurso pertence a outro tenant e o ator não tem escopo global.')
  }
}

export type DbClient = typeof db
