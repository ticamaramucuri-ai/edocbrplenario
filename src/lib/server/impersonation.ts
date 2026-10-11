/**
 * Fase 20 — helpers de impersonação auditada de suporte.
 * Serialização (SupportImpersonationView) e resolução do ator de SUPORTE a
 * partir da sessão (usuário REAL, ignorando a impersonação ativa — durante a
 * impersonação a sessão enxerga o ALVO, mas o RBAC de iniciar/encerrar é do
 * suporte). Sem sessão válida, cai no modo demo (x-actor-id) para leitura.
 */
import type { SupportImpersonation, User } from '@prisma/client'
import { db } from '@/lib/db'
import type { ResolvedActor } from '@/lib/server/actor'
import { resolveActor } from '@/lib/server/actor'
import { unauthenticated } from '@/lib/server/errors'
import { getSessionToken, resolveSessionContext } from '@/lib/server/session'
import type { Role, SupportImpersonationView } from '@/lib/contracts'

export const PLATFORM_ROLES: Role[] = ['platform_owner', 'platform_support']

/** Ator a partir do usuário REAL da sessão (suporte) — ignora impersonação. */
export function supportActorFrom(user: User): ResolvedActor {
  const role = user.role as Role
  return {
    id: user.id,
    name: user.name,
    role,
    jobTitle: user.jobTitle ?? null,
    tenantId: user.tenantId ?? null,
    parliamentarianId: user.parliamentarianId ?? null,
    isPlatform: PLATFORM_ROLES.includes(role),
  }
}

/**
 * Resolve o ator de suporte: com sessão, usa o usuário REAL (o alvo de uma
 * impersonação ativa jamais autoriza rotas de impersonação); sem sessão, cai
 * no modo demo (x-actor-id — lança 401 sem header).
 */
export async function resolveSupportActor(req: Request): Promise<ResolvedActor> {
  const token = getSessionToken(req)
  if (token) {
    const ctx = await resolveSessionContext(token)
    if (!ctx) {
      throw unauthenticated('Sessão inválida ou expirada. Entre novamente com e-mail e senha.')
    }
    return supportActorFrom(ctx.sessionUser)
  }
  return resolveActor(req)
}

/** Contexto de sessão (com impersonação) quando existir; null no modo demo. */
export async function optionalSessionContext(req: Request) {
  const token = getSessionToken(req)
  return token ? await resolveSessionContext(token) : null
}

/** SupportImpersonation + nomes resolvidos → SupportImpersonationView. */
export function toImpersonationView(
  imp: SupportImpersonation,
  supportName: string,
  targetName: string
): SupportImpersonationView {
  const ended = imp.endedAt ?? null
  return {
    id: imp.id,
    supportName,
    targetName,
    reason: imp.reason,
    startedAt: imp.startedAt.toISOString(),
    expiresAt: imp.expiresAt.toISOString(),
    endedAt: ended ? ended.toISOString() : null,
    active: !ended && imp.expiresAt.getTime() > Date.now(),
  }
}

/** Nome do usuário pelo id (para auditorias e views). */
export async function userName(id: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id }, select: { name: true } })
  return user?.name ?? null
}
