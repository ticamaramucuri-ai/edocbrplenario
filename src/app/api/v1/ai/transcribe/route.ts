/**
 * POST /api/v1/ai/transcribe {audioBase64, sessionId?, note?} — transcrição de
 * áudio (ASR glm-asr). Base64 SEM prefixo data:; limite de 8MB (400
 * VALIDATION_ERROR). Saída é RASCUNHO editável. RBAC: ai.use.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireEntitled } from '@/lib/server/entitlements'
import { loadSession } from '@/lib/server/loaders'
import { transcribeAudio } from '@/lib/server/ai'
import { persistAiArtifact, toAiArtifactView } from '@/lib/server/ai-artifacts'
import type { AiArtifact } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Limite de segurança: 8MB de base64 (~6MB de áudio). */
const MAX_BASE64_CHARS = 8 * 1024 * 1024

const bodySchema = z.object({
  audioBase64: z.string().min(16, 'Áudio (base64) inválido.'),
  sessionId: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'ai.use')
  // Fase 8 — entitlement: ai_assist exige plano profissional+ (402 PLAN_LIMIT)
  await requireEntitled(actor.tenantId, 'ai_assist')
  const body = bodySchema.parse(await req.json())

  // Remove prefixo data:*;base64, caso o cliente envie.
  const audioBase64 = body.audioBase64.replace(/^data:[^,]*;base64,/, '')

  if (audioBase64.length > MAX_BASE64_CHARS) {
    throw new DomainError(
      'VALIDATION_ERROR',
      400,
      'Áudio muito grande',
      `O áudio excede o limite de 8MB em base64 (${(audioBase64.length / 1024 / 1024).toFixed(1)}MB). Compacte ou corte o trecho.`
    )
  }

  let sessionId: string | null = null
  let tenantId: string
  if (body.sessionId) {
    const session = await loadSession(actor, body.sessionId)
    sessionId = session.id
    tenantId = session.tenantId
  } else {
    tenantId = await resolveTenantScope(req, actor)
  }

  const asr = await transcribeAudio(audioBase64)

  const artifact: AiArtifact = await withTransaction(async (tx) =>
    persistAiArtifact(tx, {
      tenantId,
      actor,
      kind: 'transcript',
      sessionId,
      input: {
        sessionId,
        note: body.note ?? null,
        audioBase64Chars: audioBase64.length,
        aproxBytes: Math.floor((audioBase64.length * 3) / 4),
      },
      output: { text: asr.text, aviso: 'Transcrição automática (rascunho) — revisão humana obrigatória' },
      model: asr.model,
      correlationId,
      ip: clientIp(req),
    })
  )

  return Response.json({ artifact: toAiArtifactView(artifact), text: asr.text }, { status: 201 })
})
