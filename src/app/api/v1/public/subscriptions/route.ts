/**
 * POST /api/v1/public/subscriptions — assinatura do cidadão (Fase 19, ADR-020).
 * Endpoint PÚBLICO sem autenticação; tenant resolvido por `?tenant=slug`
 * (padrão das rotas public/*). Dupla confirmação (double opt-in):
 *  - nova assinatura nasce `pending` com token UUID e resposta 201 SEM
 *    expor o token; entrega por fila SMTP quando configurada, com orientação
 *    explícita quando o transporte institucional ainda não está ativo;
 *  - idempotente por (tenant, e-mail, alvo): pendente → 200 "aguardando
 *    confirmação" (token NÃO é reemitido, fila antiga é reparada); confirmada → 200 com a view;
 *  - assinatura REVOGADA pelo tenant que assina de novo → reativação com
 *    novo token e nova confirmação pendente (único registro por par único).
 *
 * Regras: e-mail normalizado (trim + lowercase) e validado por Zod; alvo
 * precisa existir no tenant (sessão rascunho / audiência cancelada → 404).
 * Rate limit: 5 requisições / hora / IP (bucket public:subscriptions) —
 * 429 Problem Details + Retry-After. Sem auditoria (rota anônima — o e-mail
 * do cidadão não entra na cadeia pública); o e-mail é enfileirado na mesma
 * transação do registro, sem expor o token na resposta ou nos logs.
 */
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { mailTransportConfigured, queueSubscriptionConfirmation } from '@/lib/server/mail-delivery'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import {
  hitRateLimit,
  rateLimitKey,
  rateLimitedProblem,
  RATE_WINDOW,
} from '@/lib/server/rate-limit'
import {
  resolveSubscriptionTarget,
  toCitizenSubscriptionView,
} from '@/lib/server/subscriptions'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 5
const RATE_WINDOW_MS = RATE_WINDOW.HOUR

const createSchema = z.object({
  email: z.string().trim().email('E-mail inválido.').max(254, 'E-mail inválido.'),
  targetKind: z.enum(['matter', 'session', 'hearing'], {
    message: 'Tipo de alvo inválido (matter, session ou hearing).',
  }),
  targetId: z.string().trim().min(1, 'Informe a matéria, sessão ou audiência a acompanhar.'),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  // Rate limit ANTES de qualquer trabalho (protege também a validação/DB).
  const rl = await hitRateLimit(
    'public:subscriptions',
    rateLimitKey(clientIp(req)),
    RATE_LIMIT,
    RATE_WINDOW_MS
  )
  if (!rl.allowed) {
    return rateLimitedProblem(
      correlationId,
      rl.retryAfterSeconds,
      `Limite de assinaturas atingido (${RATE_LIMIT} por hora). Tente novamente em ${rl.retryAfterSeconds}s.`
    )
  }

  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))
  const body = createSchema.parse(await req.json())
  // Normalização canônica: trim já pelo Zod, lowercase aqui.
  const email = body.email.toLowerCase()

  // Alvo precisa existir (e ser publicamente acompanhável) no tenant.
  const targetLabel = await resolveSubscriptionTarget(tenant.id, body.targetKind, body.targetId)
  if (targetLabel === null) {
    throw notFound('Alvo do acompanhamento não encontrado neste tenant.')
  }

  const existing = await db.citizenSubscription.findUnique({
    where: {
      tenantId_email_targetKind_targetId: {
        tenantId: tenant.id,
        email,
        targetKind: body.targetKind,
        targetId: body.targetId,
      },
    },
  })
  const confirmationDelivery = mailTransportConfigured() ? 'queued' : 'awaiting_configuration'
  const pendingMessage = confirmationDelivery === 'queued'
    ? 'Assinatura registrada. O link de confirmação está na fila de e-mail; confira sua caixa de entrada após o envio.'
    : 'Assinatura registrada. O correio institucional ainda não está configurado; a Câmara deve orientar a confirmação.'

  // Idempotência: pendente → 200 sem reemitir token.
  if (existing && !existing.revokedAt && !existing.confirmedAt) {
    await withTransaction((tx) => queueSubscriptionConfirmation(tx, existing))
    return Response.json({
      status: 'pending',
      message: pendingMessage,
      confirmationDelivery,
      subscription: toCitizenSubscriptionView(existing, targetLabel),
    })
  }

  // Idempotência: confirmada → 200 com a view.
  if (existing && !existing.revokedAt && existing.confirmedAt) {
    return Response.json({
      status: 'confirmed',
      message:
        'Assinatura já confirmada — você continuará recebendo as novidades deste acompanhamento.',
      subscription: toCitizenSubscriptionView(existing, targetLabel),
    })
  }

  // Revogada + nova assinatura → reativa com novo token (double opt-in de novo).
  const subscription = await withTransaction(async (tx) => {
    const current = existing
      ? await tx.citizenSubscription.update({
          where: { id: existing.id },
          data: { token: randomUUID(), confirmedAt: null, revokedAt: null },
        })
      : await tx.citizenSubscription.create({
          data: {
            tenantId: tenant.id,
            email,
            targetKind: body.targetKind,
            targetId: body.targetId,
            token: randomUUID(),
            confirmedAt: null,
            revokedAt: null,
          },
        })
    await queueSubscriptionConfirmation(tx, current)
    return current
  })

  return Response.json(
    {
      status: 'pending',
      message: pendingMessage,
      confirmationDelivery,
      subscription: toCitizenSubscriptionView(subscription, targetLabel),
    },
    { status: 201 }
  )
})
