/**
 * Persistência de artefatos de IA (Fase 7) — gravação transacional com
 * auditoria `ai.artifact_created`/`ai.artifact_reviewed` + outbox INTERNO
 * `ai.artifact` (nunca público: rascunho de IA não vai para portal/telão).
 * Regra do prompt mestre 7.13: nenhum artefato é documento oficial; aprovação
 * apenas registra o revisor — não publica nada.
 */
import type { Prisma, AiArtifact } from '@prisma/client'
import type { ResolvedActor } from './actor'
import type { AiArtifactView, AiArtifactStatus, AiArtifactKind } from '@/lib/contracts'
import { writeAudit } from './audit'
import { emitOutbox } from './outbox'

type Tx = Prisma.TransactionClient

export type PersistAiArtifactInput = {
  tenantId: string
  actor: ResolvedActor
  kind: AiArtifactKind
  sessionId?: string | null
  matterId?: string | null
  /** Contexto enviado ao modelo (JSON stringificado na coluna `input`). */
  input: Record<string, unknown>
  /** Saída parseada do modelo (JSON stringificado na coluna `output`). */
  output: Record<string, unknown>
  model: string
  correlationId: string
  ip?: string | null
}

function artifactOutboxPayload(artifact: AiArtifact): Record<string, unknown> {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    status: artifact.status,
    sessionId: artifact.sessionId ?? undefined,
    matterId: artifact.matterId ?? undefined,
    model: artifact.model,
    provider: artifact.provider,
  }
}

export async function persistAiArtifact(tx: Tx, input: PersistAiArtifactInput): Promise<AiArtifact> {
  const artifact = await tx.aiArtifact.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      sessionId: input.sessionId ?? null,
      matterId: input.matterId ?? null,
      input: JSON.stringify(input.input),
      output: JSON.stringify(input.output),
      model: input.model,
      provider: 'z-ai',
      status: 'draft',
    },
  })

  await writeAudit(tx, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: 'ai.artifact_created',
    aggregateType: 'ai_artifact',
    aggregateId: artifact.id,
    summary: `Artefato de IA gerado (${artifact.kind}, modelo ${artifact.model}) — status rascunho.`,
    after: { kind: artifact.kind, model: artifact.model, status: 'draft' },
    correlationId: input.correlationId,
    ip: input.ip ?? null,
  })

  // Evento SOMENTE interno (nada de rascunho de IA no portal/telão).
  await emitOutbox(tx, {
    tenantId: input.tenantId,
    eventType: 'ai.artifact',
    aggregateId: artifact.id,
    sessionId: artifact.sessionId,
    aggregateVersion: 1,
    correlationId: input.correlationId,
    internalPayload: artifactOutboxPayload(artifact),
    publicPayload: null,
  })

  return artifact
}

export async function persistAiArtifactReview(
  tx: Tx,
  input: {
    artifact: AiArtifact
    actor: ResolvedActor
    decision: 'approve' | 'reject'
    justification?: string
    correlationId: string
    ip?: string | null
  }
): Promise<AiArtifact> {
  const reviewedAt = new Date()
  const updated = await tx.aiArtifact.update({
    where: { id: input.artifact.id },
    data: {
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      reviewedBy: input.actor.name,
      reviewedAt,
    },
  })

  await writeAudit(tx, {
    tenantId: input.artifact.tenantId,
    actor: input.actor,
    action: 'ai.artifact_reviewed',
    aggregateType: 'ai_artifact',
    aggregateId: input.artifact.id,
    summary:
      input.decision === 'approve'
        ? `Artefato de IA aprovado (${input.artifact.kind}) por ${input.actor.name} — aprovação NÃO publica o conteúdo.`
        : `Artefato de IA rejeitado (${input.artifact.kind}) por ${input.actor.name}.`,
    before: { status: 'draft' },
    after: {
      status: updated.status,
      reviewedBy: updated.reviewedBy,
      reviewedAt: reviewedAt.toISOString(),
    },
    justification: input.justification ?? null,
    correlationId: input.correlationId,
    ip: input.ip ?? null,
  })

  await emitOutbox(tx, {
    tenantId: input.artifact.tenantId,
    eventType: 'ai.artifact',
    aggregateId: updated.id,
    sessionId: updated.sessionId,
    aggregateVersion: 1,
    correlationId: input.correlationId,
    internalPayload: artifactOutboxPayload(updated),
    publicPayload: null,
  })

  return updated
}

export function toAiArtifactView(a: AiArtifact): AiArtifactView {
  let output: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(a.output)
    output = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { text: a.output }
  } catch {
    output = { text: a.output }
  }
  return {
    id: a.id,
    kind: a.kind as AiArtifactKind,
    sessionId: a.sessionId ?? null,
    matterId: a.matterId ?? null,
    model: a.model,
    provider: a.provider,
    status: a.status as AiArtifactStatus,
    reviewedBy: a.reviewedBy ?? null,
    reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    output,
  }
}
