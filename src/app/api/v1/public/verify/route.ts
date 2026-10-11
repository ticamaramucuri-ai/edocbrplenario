/**
 * GET /api/v1/public/verify?code= — verificação pública de autenticidade
 * (Fase 19, ADR-020). PÚBLICO, sem tenant na URL: o código de verificação é
 * aleatório (8 chars [A-Z0-9]) e globalmente raro, então a busca percorre
 * TODOS os tenants e devolve o nome da Casa (join com Tenant).
 *
 * Resultado (PublicVerifyResult, contracts.ts):
 *  - publicação PUBLICADA → found=true, kind='publication', status 'valida';
 *  - publicação REVOGADA → found=true, status 'revogada' (publishedAt +
 *    revokedAt preenchidos — campo extra além do contrato mínimo);
 *  - código inexistente (ou de rascunho — documento ainda não oficial) →
 *    found=false, status 'nao_encontrada' (HTTP 200: consulta válida).
 *
 * NOTA: ATAS usam código derivado da cadeia de auditoria (hash chain) e são
 * verificadas no módulo Relatórios, pelo painel autenticado — este endpoint
 * público cobre as publicações do DIÁRIO ELETRÔNICO.
 *
 * Rate limit: 30 requisições / minuto / IP (bucket public:verify) — 429
 * Problem Details + Retry-After. Código normalizado (trim + uppercase).
 */
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import {
  hitRateLimit,
  rateLimitKey,
  rateLimitedProblem,
  RATE_WINDOW,
} from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 30
const RATE_WINDOW_MS = RATE_WINDOW.MINUTE

export const GET = apiHandler(async (req: Request, _ctx, correlationId) => {
  const rl = hitRateLimit(
    'public:verify',
    rateLimitKey(clientIp(req)),
    RATE_LIMIT,
    RATE_WINDOW_MS
  )
  if (!rl.allowed) {
    return rateLimitedProblem(
      correlationId,
      rl.retryAfterSeconds,
      `Limite de verificações atingido (${RATE_LIMIT} por minuto). Tente novamente em ${rl.retryAfterSeconds}s.`
    )
  }

  const code = new URL(req.url).searchParams.get('code')?.trim().toUpperCase() ?? ''
  if (!code) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Parâmetro code é obrigatório (código impresso no documento).',
      { errors: { code: ['Informe o código de verificação do documento.'] } }
    )
  }

  // Busca global: draft não é documento oficial — não verifica como válida.
  const publication = await db.publication.findFirst({
    where: { verificationCode: code, status: { in: ['published', 'revoked'] } },
    include: { tenant: { select: { name: true } } },
  })

  if (!publication) {
    return Response.json({
      found: false,
      kind: null,
      code,
      title: null,
      tenantName: null,
      publishedAt: null,
      status: 'nao_encontrada',
    })
  }

  return Response.json({
    found: true,
    kind: 'publication',
    code,
    title: publication.title,
    tenantName: publication.tenant.name,
    publishedAt: publication.publishedAt?.toISOString() ?? null,
    revokedAt: publication.revokedAt?.toISOString() ?? null,
    status: publication.status === 'revoked' ? 'revogada' : 'valida',
  })
})
