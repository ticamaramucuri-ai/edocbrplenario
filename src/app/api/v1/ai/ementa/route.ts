/**
 * POST /api/v1/ai/ementa {matterId?} ou {text} — sugestão de ementa aprimorada
 * + classificação temática. Com matterId carrega a matéria persistida
 * (ementa+tipo+autores); apenas `text` parte do texto bruto. RBAC: ai.use.
 * Saída é RASCUNHO (aplicação sempre manual pelo administrador).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireEntitled } from '@/lib/server/entitlements'
import { loadMatter } from '@/lib/server/loaders'
import { parseAuthors } from '@/lib/server/serializers'
import { llmComplete, parseJsonFromLlm } from '@/lib/server/ai'
import { persistAiArtifact, toAiArtifactView } from '@/lib/server/ai-artifacts'
import { MATTER_STATUS_LABEL, MATTER_TYPE_LABEL, type EmentaSuggestion } from '@/lib/contracts'
import type { AiArtifact, LegislativeMatter } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const bodySchema = z
  .object({
    matterId: z.string().min(1).optional(),
    text: z.string().min(20, 'Texto bruto deve ter ao menos 20 caracteres.').max(20000).optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.matterId && !body.text) {
      ctx.addIssue({
        code: 'custom',
        path: ['matterId'],
        message: 'Informe matterId (matéria existente) ou text (texto bruto da proposição).',
      })
    }
  })

const SYSTEM_PROMPT = [
  'Você é um jurista redator de ementas de matérias legislativas municipais brasileiras.',
  'REGRAS:',
  '1. A ementa deve ser objetiva, em uma única frase, iniciando por verbo de ação no infinitivo (Cria, Altera, Declara, Autoriza, Reconhece, Institui, Dispõe...).',
  '2. Use EXCLUSIVAMENTE as informações do contexto; não invente finalidades, valores ou prazos.',
  '3. Responda SOMENTE com um objeto JSON válido (sem texto fora do JSON), no formato:',
  '{"ementaSugerida": string, "temas": string[], "justificativa": string}',
  'onde "temas" tem de 3 a 6 temas curtos (classificação temática) e "justificativa" explica de forma objetiva as melhorias em relação à ementa original (ou a leitura do texto bruto).',
].join('\n')

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'ai.use')
  // Fase 8 — entitlement: ai_assist exige plano profissional+ (402 PLAN_LIMIT)
  await requireEntitled(actor.tenantId, 'ai_assist')
  const body = bodySchema.parse(await req.json())

  let matter: LegislativeMatter | null = null
  if (body.matterId) {
    matter = await loadMatter(actor, body.matterId)
  }
  const tenantId = matter?.tenantId ?? (await resolveTenantScope(req, actor))

  const context: Record<string, unknown> = matter
    ? {
        materia: {
          tipo: MATTER_TYPE_LABEL[matter.type as keyof typeof MATTER_TYPE_LABEL] ?? matter.type,
          numero: `${matter.number}/${matter.year}`,
          ementaAtual: matter.ementa,
          autores: parseAuthors(matter.authors),
          situacao: MATTER_STATUS_LABEL[matter.status as keyof typeof MATTER_STATUS_LABEL] ?? matter.status,
          regime: matter.regime,
        },
      }
    : { textoBruto: body.text }

  const instruction = matter
    ? 'INSTRUÇÃO: Proponha uma ementa aprimorada para esta matéria (mais clara, precisa e aderida à técnica legislativa) e a classificação temática. Responda apenas com o JSON no formato especificado.'
    : 'INSTRUÇÃO: A partir do texto bruto da proposição, sugira a ementa da matéria e a classificação temática. Responda apenas com o JSON no formato especificado.'

  const llm = await llmComplete(SYSTEM_PROMPT, `CONTEXTO:\n${JSON.stringify(context, null, 2)}\n\n${instruction}`)

  const parsed = parseJsonFromLlm<Record<string, unknown>>(llm.text)
  const temas = Array.isArray(parsed.temas) ? parsed.temas.map((t) => String(t)).filter((t) => t.trim()) : []
  const output: EmentaSuggestion = {
    ementaSugerida:
      typeof parsed.ementaSugerida === 'string' && parsed.ementaSugerida.trim()
        ? parsed.ementaSugerida.trim()
        : matter?.ementa ?? '',
    temas: temas.length > 0 ? temas.slice(0, 8) : ['[CONFIRMAR]'],
    justificativa:
      typeof parsed.justificativa === 'string' && parsed.justificativa.trim()
        ? parsed.justificativa.trim()
        : 'Sugestão gerada por IA — aplicação manual pelo administrador, com revisão obrigatória.',
  }

  if (!output.ementaSugerida) {
    throw new DomainError(
      'AI_PROVIDER_ERROR',
      502,
      'Provedor de IA indisponível',
      'A resposta do modelo não continha uma ementa utilizável.'
    )
  }

  const artifact: AiArtifact = await withTransaction(async (tx) =>
    persistAiArtifact(tx, {
      tenantId,
      actor,
      kind: 'ementa',
      matterId: matter?.id ?? null,
      input: { system: SYSTEM_PROMPT, contexto: context, instrucao: instruction },
      output: { ...output, aviso: 'Rascunho de IA — aplicação manual pelo administrador' },
      model: llm.model,
      correlationId,
      ip: clientIp(req),
    })
  )

  return Response.json({ artifact: toAiArtifactView(artifact), output }, { status: 201 })
})
