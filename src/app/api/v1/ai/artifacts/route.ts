/**
 * GET /api/v1/ai/artifacts?kind=&sessionId=&matterId=&limit= — galeria de
 * artefatos de IA do tenant com status/model/createdAt. Leitura liberada para
 * TODOS os atores do tenant (a geração exige ai.use; a revisão, ai.review).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { toAiArtifactView } from '@/lib/server/ai-artifacts'
import { AI_KIND_LABEL, type AiArtifactKind } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)

  const params = req.nextUrl.searchParams
  const kind = params.get('kind')
  const sessionId = params.get('sessionId')
  const matterId = params.get('matterId')
  const limitRaw = params.get('limit')
  const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '50', 10) || 50, 1), 200)

  if (kind && !(kind in AI_KIND_LABEL)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      400,
      'Dados inválidos',
      `kind inválido — use um de: ${Object.keys(AI_KIND_LABEL).join(', ')}.`
    )
  }

  const artifacts = await db.aiArtifact.findMany({
    where: {
      tenantId,
      ...(kind ? { kind: kind as AiArtifactKind } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(matterId ? { matterId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return Response.json({ artifacts: artifacts.map(toAiArtifactView) })
})
