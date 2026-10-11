/**
 * POST /api/v1/public/onboarding — pedido público de criação de câmara
 * (Onda 5 / Fase 24 — self-onboarding, ADR-025).
 *
 * Endpoint PÚBLICO sem autenticação (mesmo padrão de /public/subscriptions):
 * uma câmara interessada se cadastra sozinha e o pedido entra na fila de
 * análise da plataforma (status `pendente`). A ativação é HUMANA
 * (POST /platform/onboarding/:id/activate — platform.manage).
 *
 * Regras:
 *  - Rate limit 3 requisições / hora / IP (bucket public:onboarding) —
 *    429 Problem Details + Retry-After;
 *  - slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–40) precisa estar LIVRE entre os
 *    OnboardingRequest (ativada/rejeitada também ocupam o slug — histórico
 *    preservado) E entre os Tenant existentes → 409 SLUG_TAKEN;
 *  - UF com 2 letras A-Z; e-mail normalizado (trim + lowercase).
 *
 * Sem auditoria (rota anônima — o e-mail do responsável não entra na cadeia
 * de auditoria de nenhum tenant) e sem outbox (o evento é a própria fila).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, slugTaken } from '@/lib/server/errors'
import {
  hitRateLimit,
  rateLimitKey,
  rateLimitedProblem,
  RATE_WINDOW,
} from '@/lib/server/rate-limit'
import type { OnboardingRequest } from '@prisma/client'
import type { OnboardingRequestView, OnboardingStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 3
const RATE_WINDOW_MS = RATE_WINDOW.HOUR

const createSchema = z.object({
  chamberName: z
    .string()
    .trim()
    .min(3, 'Nome da câmara deve ter no mínimo 3 caracteres.')
    .max(80, 'Nome da câmara deve ter no máximo 80 caracteres.'),
  city: z
    .string()
    .trim()
    .min(2, 'Cidade deve ter no mínimo 2 caracteres.')
    .max(60, 'Cidade deve ter no máximo 60 caracteres.'),
  uf: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, 'UF inválida — informe a sigla com 2 letras maiúsculas (ex.: MG).'),
  email: z.string().trim().email('E-mail inválido.').max(254, 'E-mail inválido.'),
  slug: z
    .string()
    .trim()
    .min(3, 'Slug deve ter no mínimo 3 caracteres.')
    .max(40, 'Slug deve ter no máximo 40 caracteres.')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug inválido — use apenas letras minúsculas, números e hífens (ex.: camara-vila-nova).'
    ),
})

/** Serialização canônica do pedido (contrato OnboardingRequestView). */
function toOnboardingRequestView(r: OnboardingRequest): OnboardingRequestView {
  return {
    id: r.id,
    chamberName: r.chamberName,
    city: r.city,
    uf: r.uf,
    email: r.email,
    slug: r.slug,
    status: r.status as OnboardingStatus,
    note: r.note ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  // Rate limit ANTES de qualquer trabalho (protege também validação/DB).
  const rl = hitRateLimit(
    'public:onboarding',
    rateLimitKey(clientIp(req)),
    RATE_LIMIT,
    RATE_WINDOW_MS
  )
  if (!rl.allowed) {
    return rateLimitedProblem(
      correlationId,
      rl.retryAfterSeconds,
      `Limite de pedidos atingido (${RATE_LIMIT} por hora por IP). Tente novamente em ${rl.retryAfterSeconds}s.`
    )
  }

  const body = createSchema.parse(await req.json())
  const email = body.email.toLowerCase()
  const slug = body.slug

  // Slug precisa estar livre ENTRE OS PEDIDOS (ativada/rejeitada também ocupam)
  // e ENTRE OS TENANTS existentes — dois checks explícitos para mensagens claras.
  const takenByRequest = await db.onboardingRequest.findUnique({ where: { slug } })
  if (takenByRequest) {
    throw slugTaken(
      `O slug "${slug}" já foi usado por um pedido de onboarding (status ${takenByRequest.status}). ` +
        'Escolha outro identificador para a sua câmara.'
    )
  }
  const takenByTenant = await db.tenant.findUnique({ where: { slug } })
  if (takenByTenant) {
    throw slugTaken(
      `O slug "${slug}" já pertence a uma câmara ativa na plataforma. Escolha outro identificador.`
    )
  }

  const created = await db.onboardingRequest.create({
    data: {
      chamberName: body.chamberName,
      city: body.city,
      uf: body.uf,
      email,
      slug,
      status: 'pendente',
    },
  })

  return Response.json(
    {
      request: toOnboardingRequestView(created),
      message:
        'Pedido recebido! A equipe da plataforma vai analisar os dados e entrar em contato ' +
        'para ativar o trial de 14 dias do plano profissional.',
    },
    { status: 201 }
  )
})
