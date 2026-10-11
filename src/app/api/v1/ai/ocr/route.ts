/**
 * POST /api/v1/ai/ocr {imageBase64, mimeType} — extração de texto integral de
 * documento fotografado via VLM (glm-4.6v), preservando a estrutura.
 * Saída é RASCUNHO editável. RBAC: ai.use. Limite 8MB base64 (400).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireEntitled } from '@/lib/server/entitlements'
import { visionExtract } from '@/lib/server/ai'
import { persistAiArtifact, toAiArtifactView } from '@/lib/server/ai-artifacts'
import type { AiArtifact } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BASE64_CHARS = 8 * 1024 * 1024

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']

const bodySchema = z.object({
  imageBase64: z.string().min(16, 'Imagem (base64) inválida.'),
  mimeType: z.string().min(3, 'Informe o mimeType da imagem.'),
})

const OCR_PROMPT = [
  'Extraia o texto INTEGRAL do documento fotografado nesta imagem, preservando a estrutura',
  'original (títulos, parágrafos, listas, numeração, tabelas simples).',
  'Regras: (1) transcreva apenas o que está visível; não invente nem complete trechos ilegíveis —',
  'use [ILEGÍVEL] onde não houver como ler; (2) mantenha o idioma original do documento;',
  '(3) responda APENAS com o texto transcrito, sem comentários.',
].join(' ')

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'ai.use')
  // Fase 8 — entitlement: ai_assist exige plano profissional+ (402 PLAN_LIMIT)
  await requireEntitled(actor.tenantId, 'ai_assist')
  const body = bodySchema.parse(await req.json())

  const mimeType = body.mimeType.toLowerCase().split(';')[0].trim()
  if (!ALLOWED_MIME.includes(mimeType)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      400,
      'Tipo de imagem não suportado',
      `mimeType deve ser um de: ${ALLOWED_MIME.join(', ')}.`
    )
  }

  const imageBase64 = body.imageBase64.replace(/^data:[^,]*;base64,/, '')
  if (imageBase64.length > MAX_BASE64_CHARS) {
    throw new DomainError(
      'VALIDATION_ERROR',
      400,
      'Imagem muito grande',
      `A imagem excede o limite de 8MB em base64 (${(imageBase64.length / 1024 / 1024).toFixed(1)}MB).`
    )
  }

  const tenantId = await resolveTenantScope(req, actor)
  const vlm = await visionExtract(imageBase64, mimeType, OCR_PROMPT)

  const artifact: AiArtifact = await withTransaction(async (tx) =>
    persistAiArtifact(tx, {
      tenantId,
      actor,
      kind: 'ocr_text',
      input: { mimeType, imageBase64Chars: imageBase64.length, prompt: OCR_PROMPT },
      output: { text: vlm.text, aviso: 'Texto extraído por IA (rascunho) — revisão humana obrigatória' },
      model: vlm.model,
      correlationId,
      ip: clientIp(req),
    })
  )

  return Response.json({ artifact: toAiArtifactView(artifact), text: vlm.text }, { status: 201 })
})
