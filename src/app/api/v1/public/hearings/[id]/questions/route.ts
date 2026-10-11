/**
 * POST /api/v1/public/hearings/:id/questions — participação popular (Fase 11).
 * Envio SEM autenticação pelo portal público (candidato/estado: pergunta
 * nasce `pending` e só aparece no portal após aprovação na moderação).
 *
 * Regras: audiência precisa estar scheduled|open E com questionsOpen=true —
 * senão 409 HEARING_QUESTIONS_CLOSED. Criação em transação + notificação
 * interna (notify) para tenant_admin e legislative_admin ("Nova pergunta em
 * audiência pública"). Resposta 201 { ok, message } — sem dados internos.
 * Nenhum dado do autor é exposto publicamente antes da aprovação (LGPD).
 *
 * Fase 19 (ADR-020): rate limit 5 requisições / 10 minutos / IP (bucket
 * public:hearing-questions) ANTES de qualquer trabalho — ao exceder, 429
 * Problem Details (code RATE_LIMITED, detail com os segundos restantes) e
 * header `Retry-After` (mesmo formato de errors.ts; montado manualmente
 * porque RATE_LIMITED ainda não existe em ApiErrorCode).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import {
  hitRateLimit,
  rateLimitKey,
  rateLimitedProblem,
  RATE_WINDOW,
} from '@/lib/server/rate-limit'
import { writeAudit } from '@/lib/server/audit'
import { notify } from '@/lib/server/notify'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 5
const RATE_WINDOW_MS = RATE_WINDOW.TEN_MINUTES

const createSchema = z.object({
  authorName: z
    .string()
    .trim()
    .min(2, 'Nome deve ter entre 2 e 120 caracteres.')
    .max(120, 'Nome deve ter entre 2 e 120 caracteres.'),
  // E-mail é OPCIONAL e nunca exibido no portal (uso interno da Casa).
  authorEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().email('E-mail inválido.').optional()
  ),
  district: z.string().trim().max(80, 'Bairro deve ter no máximo 80 caracteres.').optional(),
  question: z
    .string()
    .trim()
    .min(10, 'A pergunta deve ter entre 10 e 1000 caracteres.')
    .max(1000, 'A pergunta deve ter entre 10 e 1000 caracteres.'),
})

export const POST = apiHandler(async (req: Request, ctx, correlationId) => {
  // Fase 19: rate limit por IP ANTES de qualquer trabalho (validação/DB).
  const rl = await hitRateLimit(
    'public:hearing-questions',
    rateLimitKey(clientIp(req)),
    RATE_LIMIT,
    RATE_WINDOW_MS
  )
  if (!rl.allowed) {
    return rateLimitedProblem(
      correlationId,
      rl.retryAfterSeconds,
      `Muitas perguntas enviadas (limite de ${RATE_LIMIT} a cada 10 minutos). Aguarde ${rl.retryAfterSeconds}s para tentar novamente.`
    )
  }

  const { id } = await ctx.params
  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))
  const body = createSchema.parse(await req.json())

  const hearing = await db.publicHearing.findUnique({ where: { id } })
  if (!hearing || hearing.tenantId !== tenant.id || hearing.status === 'canceled') {
    throw notFound('Audiência não encontrada neste tenant.')
  }
  if ((hearing.status !== 'scheduled' && hearing.status !== 'open') || !hearing.questionsOpen) {
    throw new DomainError(
      'HEARING_QUESTIONS_CLOSED',
      409,
      'Perguntas encerradas',
      'Perguntas encerradas para esta audiência.'
    )
  }

  const truncate = (s: string, max = 160) =>
    s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s

  await withTransaction(async (tx) => {
    await tx.hearingQuestion.create({
      data: {
        hearingId: hearing.id,
        authorName: body.authorName,
        authorEmail: body.authorEmail ?? null,
        district: body.district?.trim() || null,
        question: body.question,
        status: 'pending',
      },
    })

    // Auditoria: registro da chegada da pergunta (chain completa). O e-mail
    // NÃO é gravado no evento (apenas a existência) — exposição pública só
    // após aprovação na moderação (LGPD).
    await writeAudit(tx, {
      tenantId: hearing.tenantId,
      actor: {
        name: 'Portal público (cidadão)',
        role: 'citizen',
      } as unknown as Parameters<typeof writeAudit>[1]['actor'],
      action: 'hearing.question_received',
      aggregateType: 'hearing_question',
      aggregateId: hearing.id,
      summary: `Pergunta recebida na audiência "${hearing.title}" de ${body.authorName}: ${truncate(body.question)}.`,
      after: {
        hearingId: hearing.id,
        hearingTitle: hearing.title,
        authorName: body.authorName,
        district: body.district ?? null,
        hasEmail: Boolean(body.authorEmail),
        questionLength: body.question.length,
      },
      correlationId,
    })

    // Notificação interna aos gestores da Casa (roles com hearing.write).
    const notifyBody = `"${body.authorName}" enviou uma pergunta para a audiência "${hearing.title}": ${truncate(body.question)} — aguarda moderação em Publicações e Audiências.`
    await notify(tx, {
      tenantId: hearing.tenantId,
      title: 'Nova pergunta em audiência pública',
      body: notifyBody,
      kind: 'system',
      module: 'publications',
      targetRole: 'tenant_admin',
    })
    await notify(tx, {
      tenantId: hearing.tenantId,
      title: 'Nova pergunta em audiência pública',
      body: notifyBody,
      kind: 'system',
      module: 'publications',
      targetRole: 'legislative_admin',
    })
  })

  return Response.json(
    {
      ok: true,
      message: 'Pergunta enviada para moderação. Ela aparecerá no portal após aprovação.',
    },
    { status: 201 }
  )
})
