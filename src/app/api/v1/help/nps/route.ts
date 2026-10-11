/**
 * GET/POST /api/v1/help/nps — NPS in-app da versão atual (Fase 24, ADR-025).
 * Autenticado (qualquer papel — inclusive platform_owner sem tenant, como o
 * /help: NÃO há resolveTenantScope aqui).
 *
 *  - GET: a resposta do PRÓPRIO ator (userId) na versão atual — MyNpsView com
 *    score null quando ainda não respondeu;
 *  - POST { score 0–10, comment? ≤300 }: UPSERT idempotente por
 *    (userId, version) — o @@unique do modelo garante que o usuário atualiza a
 *    própria resposta em vez de duplicar; `role` é regravado no update (o papel
 *    pode ter mudado desde a primeira resposta).
 *
 * A consolidação (média por versão) é exposta APENAS agregada em
 * GET /platform/metrics — respostas individuais nunca saem do próprio usuário
 * (privacidade do feedback, ADR-025).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import type { MyNpsView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

/** Versão do produto avaliada — espelha src/lib/server/help-content.ts. */
const CURRENT_VERSION = '0.13.0'

const submitSchema = z.object({
  score: z
    .number({ message: 'Informe a nota de 0 a 10.' })
    .int('A nota deve ser um número inteiro de 0 a 10.')
    .min(0, 'A nota mínima é 0.')
    .max(10, 'A nota máxima é 10.'),
  comment: z
    .string()
    .trim()
    .max(300, 'O comentário deve ter no máximo 300 caracteres.')
    .optional()
    .nullable(),
})

function toMyNpsView(row: { score: number; comment: string | null } | null): MyNpsView {
  return {
    score: row ? row.score : null,
    comment: row ? row.comment : null,
    version: CURRENT_VERSION,
  }
}

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)

  const row = await db.npsResponse.findUnique({
    where: { userId_version: { userId: actor.id, version: CURRENT_VERSION } },
    select: { score: true, comment: true },
  })

  return Response.json(toMyNpsView(row))
})

export const POST = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const body = submitSchema.parse(await req.json())

  // Upsert idempotente por (userId, version) — @@unique do modelo.
  const saved = await db.npsResponse.upsert({
    where: { userId_version: { userId: actor.id, version: CURRENT_VERSION } },
    create: {
      userId: actor.id,
      role: actor.role,
      score: body.score,
      comment: body.comment ?? null,
      version: CURRENT_VERSION,
    },
    update: {
      role: actor.role,
      score: body.score,
      comment: body.comment ?? null,
    },
    select: { score: true, comment: true },
  })

  return Response.json(toMyNpsView(saved))
})
