/**
 * GET /api/v1/public/documents/verify-signature?code= — verificação pública
 * de assinatura eletrônica de ata (Onda 5 / F22, ADR-023). PÚBLICO, sem
 * ator, busca GLOBAL por signatureCode (case-insensitive → uppercase).
 *
 * Responde SignatureVerificationView { valid, document, signatoryName,
 * signedAt }: código inexistente NÃO é erro — 200 com valid=false e campos
 * null. Código existente → RECOMPUTE do hash (computeDocumentSignature) e
 * conferência de integridade (código + docHash atual da publicação + elo
 * prevHash da linha). A validação inclui o conteúdo atual do documento:
 * ata adulterada depois de assinada → valid=false.
 *
 * Rate limit 30/min/IP (mesmo bucket public:verify da Fase 19) → 429
 * Problem Details + Retry-After.
 */
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import {
  hitRateLimit,
  rateLimitKey,
  rateLimitedProblem,
  RATE_WINDOW,
} from '@/lib/server/rate-limit'
import { computeDocHash, computeDocumentSignature } from '@/lib/server/document-signatures'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 30
const RATE_WINDOW_MS = RATE_WINDOW.MINUTE

export const GET = apiHandler(async (req: Request, _ctx, correlationId) => {
  const rl = await hitRateLimit(
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
      'Parâmetro code é obrigatório (código de assinatura impresso na ata).',
      { errors: { code: ['Informe o código de assinatura eletrônica (16 caracteres).'] } }
    )
  }

  const signature = await db.documentSignature.findFirst({
    where: { signatureCode: code },
    include: { tenant: { select: { id: true } } },
  })
  if (!signature) {
    // Código inexistente NÃO é erro — resposta neutra 200 (contrato).
    return Response.json({
      valid: false,
      document: null,
      signatoryName: null,
      signedAt: null,
    })
  }

  // Integridade por RECOMPUTE: código (16 chars do HMAC recalculado) +
  // publicação ainda publicada + docHash da linha = sha256 do conteúdo ATUAL
  // (ata adulterada depois de assinada → valid=false).
  const publication = await db.publication.findUnique({
    where: { id: signature.documentId },
  })
  const recomputed = computeDocumentSignature(
    signature.tenantId,
    signature.docHash,
    signature.signatoryParliamentarianId,
    signature.signedAt.toISOString()
  )
  const valid =
    signature.signatureCode === recomputed.code &&
    !!publication &&
    publication.status === 'published' &&
    publication.tenantId === signature.tenantId &&
    computeDocHash(publication.contentMd) === signature.docHash

  return Response.json({
    valid,
    document: publication?.title ?? null,
    signatoryName: signature.signatoryName,
    signedAt: signature.signedAt.toISOString(),
  })
})
