/**
 * GET /api/v1/auth/me — dados da sessão autenticada (Fase 9).
 * Resolve POR SESSÃO APENAS (cookie `legis_session`; sem fallback para o modo
 * demo x-actor-id): sessão válida → 200 com actor + expiresAt; senão 401.
 *
 * Fase 20 (impersonação auditada): durante impersonação ATIVA o ator devolvido
 * é o USUÁRIO-ALVO (id, nome, papel, tenant) acompanhado de
 * `actor.impersonation` (ImpersonationBannerView: suporte, motivo e prazo) —
 * o frontend usa esse campo para exibir o banner âmbar permanente. A expiração
 * é LAZY no servidor: prazo vencido → a impersonação é encerrada na leitura e
 * o ator do suporte volta normalmente (sem impersonation). Suporte sem tenant
 * (platform_support) também é atendido normalmente (ator com tenantId null).
 */
import { apiHandler, unauthenticated } from '@/lib/server/errors'
import { getSessionToken, resolveSessionContext } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const token = getSessionToken(req)
  const ctx = token ? await resolveSessionContext(token) : null
  if (!ctx) throw unauthenticated('Sem sessão autenticada.')

  const { session, user, impersonation } = ctx

  return Response.json({
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      jobTitle: user.jobTitle ?? null,
      tenantId: user.tenantId ?? null,
      parliamentarianId: user.parliamentarianId ?? null,
      impersonation: impersonation
        ? {
            impersonationId: impersonation.impersonationId,
            supportName: impersonation.supportName,
            targetName: impersonation.targetName,
            reason: impersonation.reason,
            expiresAt: impersonation.expiresAt.toISOString(),
          }
        : null,
    },
    expiresAt: session.expiresAt.toISOString(),
  })
})
