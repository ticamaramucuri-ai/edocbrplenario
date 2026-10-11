/**
 * GET /api/v1/public/subscriptions/confirm?token= — confirmação da assinatura
 * do cidadão (Fase 19, ADR-020). Etapa 2 do double opt-in, PÚBLICA:
 *  - token válido e pendente → confirmedAt = agora, status 'confirmed';
 *  - idempotente: token já confirmado → 200 'already_confirmed';
 *  - token inexistente → 404 (não vaza se a assinatura existe);
 *  - assinatura revogada pelo tenant → 409 com explicação (o cidadão pode
 *    assinar de novo pela rota POST, que reativa com novo token).
 *
 * A resposta expõe apenas e-mail MASCARADO (jo***@dominio) + rótulo do alvo
 * (LGPD). Sem rate limit dedicado: o token é UUID aleatório (força bruta
 * impraticável) e a rota é somente-leitura/idempotente.
 */
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { maskEmail, resolveSubscriptionTarget } from '@/lib/server/subscriptions'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const token = new URL(req.url).searchParams.get('token')?.trim() ?? ''
  if (!token) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Parâmetro token é obrigatório (link de confirmação enviado por e-mail).',
      { errors: { token: ['Informe o token recebido por e-mail.'] } }
    )
  }

  const subscription = await db.citizenSubscription.findUnique({ where: { token } })
  if (!subscription) {
    throw notFound('Link de confirmação inválido ou expirado.')
  }

  if (subscription.revokedAt) {
    throw new DomainError(
      'CONFLICT_VERSION',
      409,
      'Assinatura revogada',
      'Esta assinatura foi revogada pela Casa Legislativa e não pode mais ser confirmada. Você pode assinar novamente pelo portal — uma nova confirmação será enviada.'
    )
  }

  // Idempotente: já confirmada → 200 sem regravar.
  if (subscription.confirmedAt) {
    return Response.json({
      status: 'already_confirmed',
      email: maskEmail(subscription.email),
      targetLabel:
        (await resolveSubscriptionTarget(
          subscription.tenantId,
          subscription.targetKind as 'matter' | 'session' | 'hearing',
          subscription.targetId
        )) ?? null,
    })
  }

  const confirmed = await db.citizenSubscription.update({
    where: { id: subscription.id },
    data: { confirmedAt: new Date() },
  })

  return Response.json({
    status: 'confirmed',
    email: maskEmail(confirmed.email),
    targetLabel:
      (await resolveSubscriptionTarget(
        confirmed.tenantId,
        confirmed.targetKind as 'matter' | 'session' | 'hearing',
        confirmed.targetId
      )) ?? null,
  })
})
