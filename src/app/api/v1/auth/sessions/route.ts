/**
 * GET /api/v1/auth/sessions — sessões ativas do próprio usuário (Onda 5 / F22).
 *
 * Autenticado (resolveActor). Lista AuthSession com `revokedAt=null` e
 * `expiresAt > agora`, ordenadas por createdAt desc. Marca `current: true`
 * na sessão cujo tokenHash bate com o cookie atual (sha256 do token — mesmo
 * formato persistido por createSession). Responde { sessions } no formato
 * AuthSessionView (userAgent, ip, createdAt, lastUsedAt, current).
 */
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { getSessionToken } from '@/lib/server/session'
import type { AuthSessionView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)

  // Sessão atual = cookie legis_session (modo demo x-actor-id não tem cookie
  // → nenhuma linha marcada como atual).
  const token = getSessionToken(req)
  const currentTokenHash = token ? createHash('sha256').update(token).digest('hex') : null

  const rows = await db.authSession.findMany({
    where: {
      userId: actor.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  const sessions: AuthSessionView[] = rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent ?? null,
    ip: s.ip ?? null,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
    current: !!currentTokenHash && s.tokenHash === currentTokenHash,
  }))

  return Response.json({ sessions })
})
