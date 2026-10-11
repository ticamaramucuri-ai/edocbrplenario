/**
 * POST /api/v1/votings/:id/votes — registro de voto (ADR-002 §3).
 * Idempotência por commandId; parlamentar PRESENTE; alteração de voto conforme
 * tenant.settings.allowVoteChange; parlamentar vota por SI MESMO; secreto nunca
 * vaza valor (auditoria sem valor, outbox público só com contagem).
 * Fase 7: regras extraídas para src/lib/server/voting-service.ts (compartilhadas
 * com o App do Parlamentar /me/vote — MESMAS regras, zero atalhos).
 * Fase 18: `value` aceita chaves de VotingOption customizadas — validado no
 * serviço contra as opções da votação (422 "chave de opção inexistente").
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiHandler, clientIp, forbiddenRole } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { castVote } from '@/lib/server/voting-service'
import { toVoteRow } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  parliamentarianId: z.string().min(1, 'Informe o parlamentar.'),
  // 'sim' | 'nao' | 'abstencao' ou chave de opção customizada (Fase 18).
  value: z.string().min(1, 'Informe o valor do voto.'),
  commandId: z.string().uuid('commandId deve ser um UUID (idempotência).'),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'vote.cast')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  // Parlamentar só vota por SI MESMO (ADR-005 §4)
  if (actor.role === 'parliamentarian' && actor.parliamentarianId !== body.parliamentarianId) {
    throw forbiddenRole('Parlamentares só podem lançar o próprio voto.')
  }

  const result = await castVote({
    actor,
    votingId: id,
    parliamentarianId: body.parliamentarianId,
    value: body.value,
    commandId: body.commandId,
    correlationId,
    ip: clientIp(req),
    source: 'operator',
  })

  return Response.json({ vote: toVoteRow(result.vote), registeredCount: result.registeredCount })
})
