/**
 * GET /api/v1/auth/mfa/status — estado do MFA do próprio ator (Onda 5 / F22).
 *
 * Autenticado (resolveActor: sessão OU modo demo). Devolve apenas
 * `{ mfaEnabled }` — o segredo NUNCA sai daqui (só existe uma vez, na
 * resposta do setup, enquanto pendente). Alimenta o badge "MFA ativo/
 * desativado" do card "Meu acesso" (módulo Usuários).
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { mfaEnabled: true },
  })
  if (!user) throw notFound('Usuário autenticado não encontrado.')

  return Response.json({ mfaEnabled: user.mfaEnabled })
})
