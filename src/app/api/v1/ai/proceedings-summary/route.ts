/**
 * POST /api/v1/ai/proceedings-summary {matterId} — resumo executivo da
 * tramitação (timeline append-only de Proceeding + situação atual) e próximos
 * passos sugeridos. RBAC: ai.use. Saída é RASCUNHO (máx. 200 palavras).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireEntitled } from '@/lib/server/entitlements'
import { loadMatter } from '@/lib/server/loaders'
import { parseAuthors } from '@/lib/server/serializers'
import { llmComplete, parseJsonFromLlm } from '@/lib/server/ai'
import { persistAiArtifact, toAiArtifactView } from '@/lib/server/ai-artifacts'
import { MATTER_STATUS_LABEL, MATTER_TYPE_LABEL, PROCEEDING_ACTION_LABEL, type ProceedingsSummary } from '@/lib/contracts'
import type { AiArtifact } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const bodySchema = z.object({
  matterId: z.string().min(1, 'Informe a matéria.'),
})

const SYSTEM_PROMPT = [
  'Você é um analista de processo legislativo de câmara municipal brasileira.',
  'REGRAS:',
  '1. O resumo deve citar EXCLUSIVAMENTE andamentos existentes no contexto; nunca invente despachos, prazos ou comissões.',
  '2. O resumo deve ter no máximo 200 palavras, em português, tom executivo e impessoal.',
  '3. "proximosPassos" deve sugerir de 2 a 5 encaminhamentos coerentes com a situação atual e a máquina de estados descrita.',
  '4. Responda SOMENTE com um objeto JSON válido (sem texto fora do JSON), no formato:',
  '{"resumo": string, "proximosPassos": string[]}',
].join('\n')

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'ai.use')
  // Fase 8 — entitlement: ai_assist exige plano profissional+ (402 PLAN_LIMIT)
  await requireEntitled(actor.tenantId, 'ai_assist')
  const body = bodySchema.parse(await req.json())

  const matter = await loadMatter(actor, body.matterId)
  const proceedings = await db.proceeding.findMany({ where: { matterId: matter.id }, orderBy: { seq: 'asc' } })

  const context = {
    materia: {
      tipo: MATTER_TYPE_LABEL[matter.type as keyof typeof MATTER_TYPE_LABEL] ?? matter.type,
      numero: `${matter.number}/${matter.year}`,
      ementa: matter.ementa,
      autores: parseAuthors(matter.authors),
      situacao: MATTER_STATUS_LABEL[matter.status as keyof typeof MATTER_STATUS_LABEL] ?? matter.status,
      regime: matter.regime,
    },
    tramitacao: proceedings.map((p) => ({
      seq: p.seq,
      acao: PROCEEDING_ACTION_LABEL[p.action] ?? p.action,
      transicao: `${p.fromStatus} → ${p.toStatus}`,
      autor: p.actorName,
      data: p.createdAt.toISOString(),
      observacoes: p.notes ?? null,
      prazo: p.dueAt?.toISOString() ?? null,
    })),
    situacoesPossiveisAPartirDaAtual:
      matter.status === 'em_tramitacao'
        ? ['incluida_pauta', 'arquivado', 'retirado']
        : matter.status === 'incluida_pauta'
          ? ['aprovado', 'rejeitado', 'retirado', 'em_tramitacao']
          : matter.status === 'arquivado'
            ? ['em_tramitacao']
            : ['situação terminal — apenas anulação formal de sessão'],
  }

  const instruction = [
    'INSTRUÇÃO: Produza um resumo executivo da tramitação desta matéria (máx. 200 palavras)',
    'e os próximos passos sugeridos. Responda apenas com o JSON no formato especificado.',
  ].join(' ')

  const llm = await llmComplete(SYSTEM_PROMPT, `CONTEXTO:\n${JSON.stringify(context, null, 2)}\n\n${instruction}`)

  const parsed = parseJsonFromLlm<Record<string, unknown>>(llm.text)
  const passos = Array.isArray(parsed.proximosPassos) ? parsed.proximosPassos.map((p) => String(p)).filter((p) => p.trim()) : []
  const output: ProceedingsSummary = {
    resumo:
      typeof parsed.resumo === 'string' && parsed.resumo.trim()
        ? parsed.resumo.trim()
        : 'Não foi possível produzir o resumo a partir do contexto informado.',
    proximosPassos: passos.length > 0 ? passos.slice(0, 6) : ['[CONFIRMAR] — sem sugestões geradas'],
  }

  const artifact: AiArtifact = await withTransaction(async (tx) =>
    persistAiArtifact(tx, {
      tenantId: matter.tenantId,
      actor,
      kind: 'proceedings_summary',
      matterId: matter.id,
      input: { system: SYSTEM_PROMPT, contexto: context, instrucao: instruction },
      output: { ...output, aviso: 'Rascunho de IA — apoio à decisão, não substitui a tramitação oficial' },
      model: llm.model,
      correlationId,
      ip: clientIp(req),
    })
  )

  return Response.json({ artifact: toAiArtifactView(artifact), output }, { status: 201 })
})
