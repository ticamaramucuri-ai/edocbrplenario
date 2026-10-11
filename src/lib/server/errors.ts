/**
 * Problem Details + wrapper de rotas — Legis SaaS (docs/api-contract.md).
 * Todo erro de API vira um problema JSON estável com correlationId.
 */
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'

/** Códigos estáveis do contrato (docs/api-contract.md). */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_TENANT'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT_VERSION'
  | 'SESSION_INVALID_TRANSITION'
  | 'SESSION_PRECONDITION'
  | 'SESSION_TYPE_DISABLED'
  | 'VOTING_INVALID_TRANSITION'
  | 'VOTING_NOT_OPEN'
  | 'VOTE_PARLIAMENTARIAN_NOT_PRESENT'
  | 'VOTE_CHANGE_NOT_ALLOWED'
  | 'VOTE_DUPLICATE_COMMAND'
  | 'QUORUM_INSUFFICIENT'
  | 'AGENDA_INVALID_STATE'
  | 'SPEECH_INVALID_TRANSITION'
  | 'MATTER_INVALID_TRANSITION'
  | 'PROCEEDING_SEQ_CONFLICT'
  | 'PROTOCOL_INVALID_TRANSITION'
  | 'WEBHOOK_INVALID_EVENT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_ARTIFACT_NOT_DRAFT'
  | 'PLAN_LIMIT'
  | 'MIGRATION_HOMOLOGATED'
  | 'MIGRATION_INVALID_STAGE'
  // Fase 9 — autenticação real
  | 'INVALID_CREDENTIALS'
  | 'TENANT_INACTIVE'
  | 'EMAIL_TAKEN'
  // Fase 10 — faturamento
  | 'INVOICE_INVALID_TRANSITION'
  | 'INVOICE_DUPLICATE_PERIOD'
  // Fase 11 — publicações e audiências
  | 'PUBLICATION_INVALID_TRANSITION'
  | 'HEARING_INVALID_TRANSITION'
  | 'HEARING_QUESTIONS_CLOSED'
  // Onda 5 — Fases 21–24
  | 'MATTER_CYCLE'
  | 'MFA_REQUIRED'
  | 'TRIAL_EXPIRED'
  | 'FORBIDDEN_SCOPE'
  | 'SLUG_TAKEN'
  | 'SCHEDULER_UNAVAILABLE'
  | 'MEDIA_INVALID_TRANSITION'
  | 'MEDIA_SOURCE_UNAVAILABLE'
  | 'MEDIA_DUPLICATE_COMMAND'
  | 'MEDIA_CONTROL_UNAVAILABLE'
  | 'MEDIA_PATH_NOT_CONFIGURED'
  | 'MEDIA_PATH_BUSY'
  | 'MEDIA_DESTINATION_NOT_FOUND'
  | 'MEDIA_DESTINATIONS_ACTIVE'
  | 'MEDIA_PUBLIC_CONFIRMATION_REQUIRED'
  | 'MEDIA_PUBLIC_URL_MISSING'
  | 'MEDIA_PUBLIC_NOT_READY'
  | 'MEDIA_TRANSMISSION_MISSING'
  | 'MEDIA_PUBLIC_LINK_MISSING'
  | 'INTERNAL_ERROR'

const TYPE_SLUG: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN_ROLE: 'forbidden',
  FORBIDDEN_TENANT: 'forbidden-tenant',
  NOT_FOUND: 'not-found',
  VALIDATION_ERROR: 'validation-error',
  CONFLICT_VERSION: 'conflict-version',
  SESSION_INVALID_TRANSITION: 'session-invalid-transition',
  SESSION_PRECONDITION: 'session-precondition',
  SESSION_TYPE_DISABLED: 'session-type-disabled',
  VOTING_INVALID_TRANSITION: 'voting-invalid-transition',
  VOTING_NOT_OPEN: 'voting-not-open',
  VOTE_PARLIAMENTARIAN_NOT_PRESENT: 'vote-parliamentarian-not-present',
  VOTE_CHANGE_NOT_ALLOWED: 'vote-change-not-allowed',
  VOTE_DUPLICATE_COMMAND: 'vote-duplicate-command',
  QUORUM_INSUFFICIENT: 'quorum-insufficient',
  AGENDA_INVALID_STATE: 'agenda-invalid-state',
  SPEECH_INVALID_TRANSITION: 'speech-invalid-transition',
  MATTER_INVALID_TRANSITION: 'matter-invalid-transition',
  PROCEEDING_SEQ_CONFLICT: 'proceeding-seq-conflict',
  PROTOCOL_INVALID_TRANSITION: 'protocol-invalid-transition',
  WEBHOOK_INVALID_EVENT: 'webhook-invalid-event',
  AI_PROVIDER_ERROR: 'ai-provider-error',
  AI_TIMEOUT: 'ai-timeout',
  AI_ARTIFACT_NOT_DRAFT: 'ai-artifact-not-draft',
  PLAN_LIMIT: 'plan-limit',
  MIGRATION_HOMOLOGATED: 'migration-homologated',
  MIGRATION_INVALID_STAGE: 'migration-invalid-stage',
  INVALID_CREDENTIALS: 'invalid-credentials',
  TENANT_INACTIVE: 'tenant-inactive',
  EMAIL_TAKEN: 'email-taken',
  INVOICE_INVALID_TRANSITION: 'invoice-invalid-transition',
  INVOICE_DUPLICATE_PERIOD: 'invoice-duplicate-period',
  PUBLICATION_INVALID_TRANSITION: 'publication-invalid-transition',
  HEARING_INVALID_TRANSITION: 'hearing-invalid-transition',
  HEARING_QUESTIONS_CLOSED: 'hearing-questions-closed',
  MATTER_CYCLE: 'matter-cycle',
  MFA_REQUIRED: 'mfa-required',
  TRIAL_EXPIRED: 'trial-expired',
  FORBIDDEN_SCOPE: 'forbidden-scope',
  SLUG_TAKEN: 'slug-taken',
  SCHEDULER_UNAVAILABLE: 'scheduler-unavailable',
  MEDIA_INVALID_TRANSITION: 'media-invalid-transition',
  MEDIA_SOURCE_UNAVAILABLE: 'media-source-unavailable',
  MEDIA_DUPLICATE_COMMAND: 'media-duplicate-command',
  MEDIA_CONTROL_UNAVAILABLE: 'media-control-unavailable',
  MEDIA_PATH_NOT_CONFIGURED: 'media-path-not-configured',
  MEDIA_PATH_BUSY: 'media-path-busy',
  MEDIA_DESTINATION_NOT_FOUND: 'media-destination-not-found',
  MEDIA_DESTINATIONS_ACTIVE: 'media-destinations-active',
  MEDIA_PUBLIC_CONFIRMATION_REQUIRED: 'media-public-confirmation-required',
  MEDIA_PUBLIC_URL_MISSING: 'media-public-url-missing',
  MEDIA_PUBLIC_NOT_READY: 'media-public-not-ready',
  MEDIA_TRANSMISSION_MISSING: 'media-transmission-missing',
  MEDIA_PUBLIC_LINK_MISSING: 'media-public-link-missing',
  INTERNAL_ERROR: 'internal-error',
}

/** Erro de domínio: carrega status + code estável e vira Problem Details. */
export class DomainError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    public readonly title: string,
    public readonly detail: string,
    public readonly extra?: Record<string, unknown>
  ) {
    super(detail)
    this.name = 'DomainError'
  }
}

export const unauthenticated = (detail = 'Header x-actor-id ausente ou inválido.') =>
  new DomainError('UNAUTHENTICATED', 401, 'Não autenticado', detail)

export const forbiddenRole = (detail: string) =>
  new DomainError('FORBIDDEN_ROLE', 403, 'Acesso negado', detail)

export const forbiddenTenant = (detail = 'Recurso pertence a outro tenant.') =>
  new DomainError('FORBIDDEN_TENANT', 403, 'Acesso negado para o tenant', detail)

/** Fase 9 — tenant desativado bloqueia papéis com escopo de tenant. */
export const forbiddenTenantInactive = (detail: string) =>
  new DomainError('TENANT_INACTIVE', 403, 'Tenant desativado', detail)

/** Fase 9 — e-mail/senha inválidos (mensagem genérica, sem vazar qual). */
export const invalidCredentials = (detail = 'E-mail ou senha inválidos.') =>
  new DomainError('INVALID_CREDENTIALS', 401, 'Credenciais inválidas', detail)

export const notFound = (detail = 'Recurso não encontrado.') =>
  new DomainError('NOT_FOUND', 404, 'Não encontrado', detail)

// ─── Onda 5 — Fases 21–24 ──────────────────────────────────────────────────

/** F21 — vínculo fecharia um ciclo no grafo de relacionamentos. */
export const matterCycle = (detail: string, path: string[]) =>
  new DomainError('MATTER_CYCLE', 422, 'Ciclo de relacionamento', detail, { path })

/** F22 — senha correta, mas o segundo fator (TOTP) é obrigatório. */
export const mfaRequired = (detail = 'Autenticação de dois fatores exigida. Informe o código TOTP.') =>
  new DomainError('MFA_REQUIRED', 401, 'Segundo fator exigido', detail)

/** F24 — trial expirado: leitura liberada, escrita bloqueada. */
export const trialExpired = (detail: string) =>
  new DomainError('TRIAL_EXPIRED', 403, 'Trial expirado', detail)

/** F23 — chave válida, mas sem o escopo exigido pelo endpoint. */
export const forbiddenScope = (detail: string) =>
  new DomainError('FORBIDDEN_SCOPE', 403, 'Escopo insuficiente', detail)

/** F24 — slug de onboarding indisponível. */
export const slugTaken = (detail: string) =>
  new DomainError('SLUG_TAKEN', 409, 'Slug indisponível', detail)

/** F21 — scheduler :3005 indisponível para execução manual. */
export const schedulerUnavailable = (detail = 'Serviço de agendamentos indisponível (porta 3005).') =>
  new DomainError('SCHEDULER_UNAVAILABLE', 503, 'Agendador indisponível', detail)

export type ProblemExtra = Record<string, unknown>

/** Monta a resposta Problem Details EXATAMENTE no formato do contrato. */
export function problem(
  status: number,
  code: ApiErrorCode,
  title: string,
  detail: string,
  correlationId: string,
  extra?: ProblemExtra
): NextResponse {
  const body: Record<string, unknown> = {
    type: `https://legis-saas/errors/${TYPE_SLUG[code] ?? 'error'}`,
    title,
    status,
    detail,
    code,
    correlationId,
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) body[k] = v
    }
  }
  return NextResponse.json(body, { status })
}

type RouteCtx = { params: Promise<Record<string, string>> }

/**
 * Wrapper de route handlers: DomainError → problem; ZodError → 422 com
 * `errors` por campo; erro inesperado → 500 + log server-side.
 * O correlationId (uuid por requisição) é injetado no handler.
 */
export function apiHandler<TRequest extends Request, TContext extends RouteCtx>(
  fn: (req: TRequest, ctx: TContext, correlationId: string) => Promise<Response>
) {
  return async (req: TRequest, ctx: TContext): Promise<Response> => {
    const correlationId = randomUUID()
    try {
      return await fn(req, ctx, correlationId)
    } catch (err) {
      if (err instanceof DomainError) {
        return problem(err.status, err.code, err.title, err.detail, correlationId, err.extra)
      }
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {}
        for (const issue of err.issues) {
          const key = issue.path.length ? issue.path.join('.') : '_'
          ;(fieldErrors[key] ??= []).push(issue.message)
        }
        return problem(
          422,
          'VALIDATION_ERROR',
          'Dados inválidos',
          'Corpo da requisição não passou na validação.',
          correlationId,
          { errors: fieldErrors }
        )
      }
      // Erro inesperado — loga no servidor, nunca vaza stack ao cliente.
      console.error(`[api] correlationId=${correlationId}`, err)
      return problem(
        500,
        'INTERNAL_ERROR',
        'Erro interno',
        'Erro inesperado ao processar a requisição. Tente novamente.',
        correlationId
      )
    }
  }
}

/** Extrai IP do cliente (headers do gateway). */
export function clientIp(req: Request): string | null {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  )
}
