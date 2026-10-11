/**
 * Autenticação das rotas externas /api/v1/external/* (Fase 23 — ADR-024).
 *
 * Duas formas de credencial Bearer:
 *  (a) real   — `Authorization: Bearer legk_…` → sha256 → lookup de ApiKey
 *               ATIVA (revokedAt null). Chave inexistente/revogada → 401.
 *  (b) delegada — `Authorization: Bearer deleg_<b64url(payload)>.<hmac>` —
 *               token de 30s mintado pelo playground (POST /api-keys/playground)
 *               para executar a consulta REAL no servidor SEM reconstruir/expor
 *               a chave: o payload carrega {keyId, tenantId, scopes, exp} e é
 *               assinado com HMAC-SHA256(LEGIS_DELEGATION_SECRET). A chave pura
 *               nunca vai ao browser e não existe recuperável (só o hash).
 *
 * Toda rota externa aplica, nesta ordem: 401 (sem/inválida credencial) →
 * 429 (rate limit 60 req/min POR CHAVE — delegação usa o keyId do payload) →
 * 403 FORBIDDEN_SCOPE (escopo exigido pelo endpoint ausente na chave) → dados
 * SOMENTE do tenant da chave (mesmo isolamento do x-actor-id, ADR-005).
 * `lastUsedAt` é best-effort com catch silencioso e NÃO há log de IP
 * (minimização LGPD).
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { API_SCOPE_ENDPOINT, type ApiScope } from '@/lib/contracts'
import { forbiddenScope, problem, unauthenticated, type DomainError } from './errors'
import { hitRateLimit, RATE_WINDOW, rateLimitedProblem } from './rate-limit'

/** Limite por chave: 60 req/min (ROADMAP §12.3 / ADR-024). */
export const EXTERNAL_RATE_LIMIT = 60

/** Vida útil do token de delegação do playground (segundos). */
export const DELEGATION_TTL_SECONDS = 30

const DELEGATION_SECRET =
  process.env.LEGIS_DELEGATION_SECRET ?? 'legis-saas-demo-delegation-secret-v1'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ─── Geração e serialização de chaves (rotas de gestão) ─────────────────────

/** Alfabeto sem caracteres ambíguos (sem I, L, O, 0 e 1). */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz'

/** Chave completa: `legk_` + 24 chars aleatórios (crypto randomInt) — exibida UMA vez. */
export function generateApiKeySecret(): string {
  let body = ''
  for (let i = 0; i < 24; i++) body += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]
  return `legk_${body}`
}

/** View pública da chave (contracts.ts) — nunca inclui hash nem segredo. */
export function toApiKeyView(key: {
  id: string
  name: string
  prefix: string
  scopes: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}): {
  id: string
  name: string
  prefix: string
  scopes: ApiScope[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
} {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: parseApiScopes(key.scopes),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }
}

/** Contexto resolvido de uma credencial externa (real ou delegada). */
export type ExternalAuth = {
  keyId: string
  tenantId: string
  scopes: ApiScope[]
}

/** Resultado da autenticação: contexto OU resposta de erro pronta (Problem Details). */
export type ExternalAuthResult = { ok: true; auth: ExternalAuth } | { ok: false; error: Response }

/** Endpoint externo → escopo exigido (derivado de API_SCOPE_ENDPOINT — fonte única). */
export const EXTERNAL_ENDPOINT_SCOPE: Record<string, ApiScope> = Object.fromEntries(
  Object.entries(API_SCOPE_ENDPOINT).map(([scope, endpoint]) => [endpoint, scope as ApiScope])
)

/** Endpoints externos válidos para o playground (mesma fonte do contrato). */
export const PLAYGROUND_ENDPOINTS: string[] = Object.keys(EXTERNAL_ENDPOINT_SCOPE)

/** Página padrão das rotas externas. */
export const EXTERNAL_PAGE_SIZE_DEFAULT = 20

/** Máximo de itens por página nas rotas externas (ROADMAP §12.3). */
export const EXTERNAL_PAGE_SIZE_MAX = 50

/** Lê ?page (≥1) e ?pageSize (1–50, default 20) dos query params. */
export function parseExternalPagination(searchParams: URLSearchParams): {
  page: number
  pageSize: number
} {
  const page = Math.max(1, parseInt(searchParams.get('page')?.trim() || '1', 10) || 1)
  const pageSize = Math.min(
    EXTERNAL_PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get('pageSize')?.trim() || String(EXTERNAL_PAGE_SIZE_DEFAULT), 10) || EXTERNAL_PAGE_SIZE_DEFAULT)
  )
  return { page, pageSize }
}

/** Faz o parse do JSON de escopos persistido, descartando valores inválidos. */
export function parseApiScopes(json: string): ApiScope[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is ApiScope =>
      (Object.keys(API_SCOPE_ENDPOINT) as string[]).includes(s)
    )
  } catch {
    return []
  }
}

// ─── Delegação assinada do playground (ADR-024) ─────────────────────────────

type DelegationPayload = {
  keyId: string
  tenantId: string
  scopes: ApiScope[]
  /** Expiração em epoch ms (agora + 30s). */
  exp: number
}

/** Minta `deleg_<base64url(payload)>.<hmac-sha256(secret, payload_b64)>`. */
export function mintDelegationToken(keyId: string, tenantId: string, scopes: ApiScope[]): string {
  const payload: DelegationPayload = {
    keyId,
    tenantId,
    scopes,
    exp: Date.now() + DELEGATION_TTL_SECONDS * 1000,
  }
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const hmac = createHmac('sha256', DELEGATION_SECRET).update(b64).digest('hex')
  return `deleg_${b64}.${hmac}`
}

/** Valida assinatura + expiração; devolve o payload ou null. */
export function verifyDelegationToken(token: string): DelegationPayload | null {
  const raw = token.slice('deleg_'.length)
  const dot = raw.indexOf('.')
  if (dot <= 0) return null
  const b64 = raw.slice(0, dot)
  const hmac = raw.slice(dot + 1)
  const expected = createHmac('sha256', DELEGATION_SECRET).update(b64).digest('hex')
  if (hmac.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(expected, 'utf8'))) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as DelegationPayload
    if (
      typeof payload.keyId !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      !Array.isArray(payload.scopes) ||
      typeof payload.exp !== 'number' ||
      payload.exp < Date.now()
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

// ─── Resolução do Bearer (comum às 4 rotas externas) ────────────────────────

/** DomainError → resposta Problem Details (correlationId da requisição). */
function problemFrom(err: DomainError, correlationId: string): Response {
  return problem(err.status, err.code, err.title, err.detail, correlationId, err.extra)
}

/**
 * Resolve o Bearer (legk_ real OU deleg_ do playground), aplica o rate limit
 * 60/min por chave, atualiza lastUsedAt (best-effort, sem IP) e exige o escopo
 * do endpoint. Devolve o contexto OU a resposta de erro pronta — o handler só
 * precisa devolvê-la.
 */
export async function resolveExternalAuth(
  req: Request,
  correlationId: string,
  requiredScope: ApiScope
): Promise<ExternalAuthResult> {
  const header = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(header)) {
    return {
      ok: false,
      error: problemFrom(
        unauthenticated('Envie o header Authorization: Bearer <chave de API legk_…>.'),
        correlationId
      ),
    }
  }
  const token = header.replace(/^Bearer\s+/i, '').trim()

  let auth: ExternalAuth
  if (token.startsWith('legk_')) {
    // (a) Chave real: sha256 → lookup; inexistente ou revogada → 401 único genérico.
    const key = await db.apiKey.findUnique({ where: { hash: sha256(token) } })
    if (!key || key.revokedAt) {
      return {
        ok: false,
        error: problemFrom(
          unauthenticated('Chave de API inválida ou revogada.'),
          correlationId
        ),
      }
    }
    auth = { keyId: key.id, tenantId: key.tenantId, scopes: parseApiScopes(key.scopes) }
  } else if (token.startsWith('deleg_')) {
    // (b) Delegação assinada do playground: HMAC + exp; escopo/tenant vêm do payload.
    const payload = verifyDelegationToken(token)
    if (!payload) {
      return {
        ok: false,
        error: problemFrom(
          unauthenticated('Token de delegação inválido ou expirado.'),
          correlationId
        ),
      }
    }
    auth = { keyId: payload.keyId, tenantId: payload.tenantId, scopes: payload.scopes }
  } else {
    return {
      ok: false,
      error: problemFrom(unauthenticated('Chave de API inválida ou revogada.'), correlationId),
    }
  }

  // Rate limit por chave compartilhado em PostgreSQL (local no piloto SQLite).
  // Delegação conta no MESMO balde via keyId do payload.
  const rl = await hitRateLimit('external:key', auth.keyId, EXTERNAL_RATE_LIMIT, RATE_WINDOW.MINUTE)
  if (!rl.allowed) {
    return {
      ok: false,
      error: rateLimitedProblem(
        correlationId,
        rl.retryAfterSeconds,
        'Limite de 60 requisições/minuto por chave excedido.'
      ),
    }
  }

  // lastUsedAt best-effort (falha silenciosa; sem log de IP — LGPD).
  void db.apiKey
    .update({ where: { id: auth.keyId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined)

  // Escopo exigido pelo endpoint.
  if (!auth.scopes.includes(requiredScope)) {
    return {
      ok: false,
      error: problemFrom(
        forbiddenScope(`A chave não possui o escopo "${requiredScope}" exigido por este endpoint.`),
        correlationId
      ),
    }
  }

  return { ok: true, auth }
}
