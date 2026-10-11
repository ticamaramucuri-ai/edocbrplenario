/**
 * DELETE /api/v1/auth/sessions/:id — revogação individual (Onda 5 / F22).
 *
 * Autenticado. Revoga (revokedAt=agora) SOMENTE se a sessão pertence ao
 * PRÓPRIO usuário (de outro usuário → 404, sem vazar existência).
 * Idempotente: sessão já revogada → 200. Encerra impersonação ativa
 * carregada pela sessão (mesma semântica do logout, Fase 20). Devolve
 * { ok: true }. Revogar a sessão CORRENTE equivale a sair — o próximo
 * request perde a autenticação por cookie.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { endImpersonation } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

export const DELETE = apiHandler(async (req, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params

  const session = await db.authSession.findUnique({ where: { id } })
  // Sessão inexistente OU de outro usuário → mesmo 404 (não vaza).
  if (!session || session.userId !== actor.id) {
    throw notFound('Sessão não encontrada para este usuário.')
  }

  // F20: encerrar impersonação ativa carregada pela sessão revogada.
  if (session.impersonationId) {
    await endImpersonation(session.impersonationId)
  }

  // Idempotente: já revogada → apenas 200.
  await db.authSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  return Response.json({ ok: true })
})
