/**
 * POST /api/v1/me/vote {votingId, value, commandId} — voto POR SI MESMO no App
 * do Parlamentar. MESMAS regras da rota do operador (serviço compartilhado
 * voting-service.ts): votação aberta, parlamentar presente, idempotência por
 * commandId (UUID gerado no cliente), alteração conforme allowVoteChange.
 * Votação secreta: o valor jamais é ecoado na resposta. RBAC: self.vote.
 * Fase 18: `value` aceita chaves de VotingOption customizadas (validadas no
 * serviço); resposta inclui `receiptPending: true` quando nominal — o recibo
 * verificável é emitido no ENCERRAMENTO (nunca durante, pois o voto pode mudar).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireMeParliamentarian } from '@/lib/server/me'
import { castVote } from '@/lib/server/voting-service'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  votingId: z.string().min(1, 'Informe a votação.'),
  // 'sim' | 'nao' | 'abstencao' ou chave de opção customizada (Fase 18).
  value: z.string().min(1, 'Informe o valor do voto.'),
  commandId: z.string().uuid('commandId deve ser um UUID (idempotência).'),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'self.vote')
  const parliamentarian = await requireMeParliamentarian(actor)
  const body = bodySchema.parse(await req.json())

  const result = await castVote({
    actor,
    votingId: body.votingId,
    parliamentarianId: parliamentarian.id,
    value: body.value,
    commandId: body.commandId,
    correlationId,
    ip: clientIp(req),
    source: 'pwa',
  })

  const secret = result.voting.mode === 'secreto'
  return Response.json({
    vote: {
      // Valor PERSISTIDO (idempotência: replay do commandId devolve o voto real).
      value: secret ? null : result.vote.value,
      receivedAt: result.vote.receivedAt.toISOString(),
      changedAt: result.vote.changedAt ? result.vote.changedAt.toISOString() : null,
    },
    registeredCount: result.registeredCount,
    // Recibo verificável é emitido no encerramento da votação (Fase 18/ADR-019)
    receiptPending: result.voting.mode === 'nominal' && result.voting.status === 'open',
  })
})
