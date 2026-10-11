/**
 * Rate limit em memória — janela deslizante por (bucket, key) (Fase 19, ADR-020).
 *
 * Implementação: Map module-level (singleton por processo) de
 * `bucket:key` → timestamps (number[]) das requisições aceitas dentro da
 * janela. Em cada chamada os timestamps expirados são removidos
 * (limpeza preguiçosa) e a requisição é aceita apenas se houver menos de
 * `limit` ocorrências na janela.
 *
 * Proteção contra crescimento ilimitado: quando o Map passa de ~10.000
 * chaves, entradas com lista vazia (após a limpeza) são removidas —
 * simples e suficiente para o sandbox (2 tenants, tráfego de demo).
 *
 * Em PostgreSQL, hits ficam no banco e a chave recebe advisory lock na
 * transação. Assim réplicas partilham a mesma janela deslizante. SQLite
 * mantém o comportamento local para desenvolvimento/demonstração.
 *
 * Limites vigentes (ROADMAP §11.3):
 *  - public:subscriptions       5 / 1h   / IP
 *  - public:verify             30 / 1min / IP
 *  - public:hearing-questions   5 / 10min / IP
 */
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'

/** Janelas de tempo convenientes (ms). */
export const RATE_WINDOW = {
  MINUTE: 60_000,
  TEN_MINUTES: 10 * 60_000,
  HOUR: 60 * 60_000,
} as const

type RateLimitResult = {
  allowed: boolean
  /** Segundos até a liberação da próxima requisição (0 quando permitido). */
  retryAfterSeconds: number
}

/** Singleton module-level — compartilhado por todas as rotas do processo. */
const buckets = new Map<string, number[]>()

/** Limite superior pragmático do Map antes da varredura de entradas vazias. */
const MAX_TRACKED_KEYS = 10_000

/**
 * Registra uma tentativa e decide se ela é permitida.
 * `bucket` agrupa por endpoint (ex.: 'public:verify'); `key` é a identidade
 * (normalmente o IP do cliente via clientIp()).
 */
function hitRateLimitLocal(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const mapKey = `${bucket}:${key}`
  const windowStart = now - windowMs

  // Limpeza preguiçosa: descarta timestamps fora da janela deslizante.
  const hits = (buckets.get(mapKey) ?? []).filter((t) => t > windowStart)

  // Janela cheia → negado; o retry é liberado quando o mais antigo sair.
  if (hits.length >= limit) {
    const oldest = hits[0]
    const retryAfterMs = Math.max(1000, oldest + windowMs - now)
    buckets.set(mapKey, hits)
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
  }

  hits.push(now)
  buckets.set(mapKey, hits)

  // Proteção contra crescimento ilimitado: com o Map grande, entradas que
  // ficaram vazias após a limpeza são removidas (varredura única, O(n) rara).
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, list] of buckets) {
      if (list.length === 0) buckets.delete(k)
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Conta hits de uma janela deslizante no PostgreSQL com serialização por chave. */
export async function hitRateLimit(bucket: string, key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
    return hitRateLimitLocal(bucket, key, limit, windowMs)
  }
  const digest = createHash('sha256').update(`${bucket}\0${key}`).digest('hex')
  const lockValue = BigInt.asIntN(64, BigInt(`0x${digest.slice(0, 16)}`))
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockValue})::text AS locked`
    await tx.rateLimitHit.deleteMany({ where: { keyHash: digest, at: { lte: windowStart } } })
    const count = await tx.rateLimitHit.count({ where: { keyHash: digest } })
    if (count >= limit) {
      const oldest = await tx.rateLimitHit.findFirst({ where: { keyHash: digest }, orderBy: { at: 'asc' }, select: { at: true } })
      const retryAfterMs = Math.max(1000, (oldest?.at.getTime() ?? now.getTime()) + windowMs - now.getTime())
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
    }
    await tx.rateLimitHit.create({ data: { keyHash: digest, at: now } })
    return { allowed: true, retryAfterSeconds: 0 }
  })
  // Limpeza probabilística limita crescimento causado por chaves que não voltam.
  if (Math.random() < 0.01) {
    void db.rateLimitHit.deleteMany({ where: { at: { lt: new Date(Date.now() - RATE_WINDOW.HOUR) } } }).catch(() => undefined)
  }
  return result
}

/**
 * Chave estável de IP para os buckets públicos: usa clientIp() e, quando o
 * sandbox não informa IP real (curl local sem proxies), cai para um fallback
 * fixo — mantém o limite demonstrável sem falsear o comportamento.
 */
export function rateLimitKey(ip: string | null): string {
  return ip && ip.trim() ? ip.trim() : 'sandbox-local'
}

/**
 * Resposta 429 no MESMO formato Problem Details de errors.ts (type/title/
 * status/detail/code/correlationId + retryAfterSeconds) com o header
 * `Retry-After` exigido pelo contrato (ROADMAP §11.3). Montada manualmente
 * porque `code: 'RATE_LIMITED'` ainda não existe em ApiErrorCode (errors.ts
 * é compartilhado e fora do ownership desta task).
 */
export function rateLimitedProblem(
  correlationId: string,
  retryAfterSeconds: number,
  detail: string
): Response {
  return Response.json(
    {
      type: 'https://legis-saas/errors/rate-limited',
      title: 'Limite de requisições excedido',
      status: 429,
      detail,
      code: 'RATE_LIMITED',
      correlationId,
      retryAfterSeconds,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}
