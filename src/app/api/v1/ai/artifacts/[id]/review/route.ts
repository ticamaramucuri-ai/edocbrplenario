/**
 * POST /api/v1/ai/artifacts/:id/review {decision: approve|reject, justification?}
 * — revisão humana obrigatória (RBAC ai.review: admin/legislativo). Aprovar
 * NÃO publica nada (regra 7.13): apenas registra reviewedBy/reviewedAt +
 * auditoria ai.artifact_reviewed (justificativa obrigatória ao rejeitar) +
 * outbox interno ai.artifact. Artefato só pode ser revisado em status draft.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { persistAiArtifactReview, toAiArtifactView } from '@/lib/server/ai-artifacts'
import { AI_STATUS_LABEL, type AiArtifactStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    justification: z.string().max(2000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.decision === 'reject' && (!body.justification || body.justification.trim().length < 3)) {
      ctx.addIssue({
        code: 'custom',
        path: ['justification'],
        message: 'Justificativa é obrigatória para rejeitar o artefato de IA.',
      })
    }
  })

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'ai.review')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const artifact = await db.aiArtifact.findUnique({ where: { id } })
  if (!artifact) throw notFound('Artefato de IA não encontrado.')
  assertTenantScope(actor, artifact.tenantId)

  if (artifact.status !== 'draft') {
    const reviewedInfo = artifact.reviewedAt
      ? ` (revisado por ${artifact.reviewedBy ?? '—'} em ${artifact.reviewedAt.toLocaleString('pt-BR')})`
      : ''
    throw new DomainError(
      'AI_ARTIFACT_NOT_DRAFT',
      409,
      'Artefato já revisado',
      `O artefato está em status "${AI_STATUS_LABEL[artifact.status as AiArtifactStatus] ?? artifact.status}"${reviewedInfo} — apenas rascunhos podem ser revisados.`
    )
  }

  const reviewed = await withTransaction(async (tx) =>
    persistAiArtifactReview(tx, {
      artifact,
      actor,
      decision: body.decision,
      justification: body.justification?.trim() || undefined,
      correlationId,
      ip: clientIp(req),
    })
  )

  return Response.json({ artifact: toAiArtifactView(reviewed) })
})
