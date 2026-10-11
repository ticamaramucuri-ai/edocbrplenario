/**
 * POST /api/v1/ai/ata-draft {sessionId} — minuta de ata gerada por LLM a partir
 * EXCLUSIVAMENTE dos dados persistidos da sessão (mesmos loaders do relatório
 * de ata). Saída é RASCUNHO com placeholders [CONFIRMAR] onde faltar dado.
 * RBAC: ai.use. Grava AiArtifact + auditoria ai.artifact_created + outbox
 * interno ai.artifact (nunca público). Timeout 60s → 504 AI_TIMEOUT.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireEntitled } from '@/lib/server/entitlements'
import { loadSession } from '@/lib/server/loaders'
import { currentAttendance } from '@/lib/server/domain'
import { parseAuthors, parseNominalDetail, parseResultCounts, sessionLabel } from '@/lib/server/serializers'
import { llmComplete, parseJsonFromLlm } from '@/lib/server/ai'
import { persistAiArtifact, toAiArtifactView } from '@/lib/server/ai-artifacts'
import { MATTER_TYPE_LABEL, SESSION_TYPE_LABEL, SPEECH_KIND_LABEL, VOTING_MODE_LABEL, VOTING_RULE_LABEL, type AtaDraftOutput } from '@/lib/contracts'
import type { AiArtifact } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const bodySchema = z.object({
  sessionId: z.string().min(1, 'Informe a sessão.'),
})

const SYSTEM_PROMPT = [
  'Você é um redator parlamentar experiente, especializado em atas de sessões legislativas municipais brasileiras.',
  'Escreva em português formal, no estilo tradicional de ata de sessão legislativa (terceira pessoa, tempo passado).',
  'REGRAS INVIOLÁVEIS:',
  '1. Use EXCLUSIVAMENTE os dados do contexto fornecido; NUNCA invente nomes, números, horários, partidos, resultados ou fatos.',
  '2. Quando um dado necessário não estiver no contexto, escreva o marcador [CONFIRMAR] no lugar.',
  '3. Não emita opiniões, elogios ou comentários fora do registro formal.',
  '4. Responda SOMENTE com um objeto JSON válido (sem texto fora do JSON), no formato:',
  '{"titulo": string, "secoes": [{"titulo": string, "texto": string}], "observacao": string}',
  'onde "observacao" lista de forma objetiva as lacunas marcadas com [CONFIRMAR] e demais limitações do rascunho.',
].join('\n')

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'ai.use')
  // Fase 8 — entitlement: ai_assist exige plano profissional+ (402 PLAN_LIMIT)
  await requireEntitled(actor.tenantId, 'ai_assist')
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, body.sessionId)

  const [attendance, agenda, votings, speeches] = await Promise.all([
    currentAttendance(db, session.id, session.tenantId),
    db.agendaItem.findMany({ where: { sessionId: session.id }, orderBy: { order: 'asc' }, include: { matter: true } }),
    db.voting.findMany({
      where: { sessionId: session.id, status: 'closed', resultStatus: { not: null } },
      orderBy: { createdAt: 'asc' },
    }),
    db.speech.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' }, include: { parliamentarian: true } }),
  ])

  // ─── Contexto (apenas dados persistidos; nada improvisado) ──────────────
  const byCategory = new Map<string, string[]>()
  for (const row of attendance.rows) {
    if (row.present) continue
    const list = byCategory.get(row.status) ?? []
    list.push(row.name)
    byCategory.set(row.status, list)
  }
  const context = {
    sessao: {
      rotulo: sessionLabel(session),
      tipo: SESSION_TYPE_LABEL[session.type as 'ordinaria'] ?? session.type,
      numero: session.number,
      ano: session.year,
      dataHoraAgendada: session.scheduledAt.toISOString(),
      abertaEm: session.openedAt?.toISOString() ?? null,
      encerradaEm: session.closedAt?.toISOString() ?? null,
      status: session.status,
      presidente: session.presidentName ?? null,
      secretario: session.secretaryName ?? null,
      local: session.location,
      observacoes: session.notes ?? null,
    },
    quorum: {
      presentes: attendance.quorum.present,
      totalMembros: attendance.quorum.total,
      minimoRegimental: attendance.quorum.required,
    },
    presenca: {
      presentes: attendance.rows.filter((r) => r.present).map((r) => `${r.name} (${r.party})`),
      porCategoria: [...byCategory.entries()].map(([status, names]) => ({ situacao: status, nomes: names })),
    },
    pauta: agenda.map((item) => ({
      ordem: item.order + 1,
      secao: item.section,
      titulo: item.title,
      materia: item.matter
        ? {
            tipo: MATTER_TYPE_LABEL[item.matter.type as keyof typeof MATTER_TYPE_LABEL] ?? item.matter.type,
            numero: `${item.matter.number}/${item.matter.year}`,
            autores: parseAuthors(item.matter.authors),
          }
        : null,
      situacao: item.status,
      resultado: item.resultSummary ?? null,
    })),
    votacoes: votings.map((v) => ({
      questao: v.question,
      modo: VOTING_MODE_LABEL[v.mode as 'nominal'] ?? v.mode,
      regra: VOTING_RULE_LABEL[v.rule as 'maioria_simples'] ?? v.rule,
      resultado: v.resultStatus,
      contagens: parseResultCounts(v.resultCounts),
      nominal:
        v.mode === 'nominal' && v.resultDetail
          ? (parseNominalDetail(v.resultDetail) ?? []).map((d) => ({ nome: d.name, voto: d.value }))
          : null,
    })),
    discursos: speeches.map((s) => ({
      orador: s.parliamentarian?.name ?? s.externalSpeaker ?? 'Orador externo',
      tipo: SPEECH_KIND_LABEL[s.kind] ?? s.kind,
      assunto: s.subject ?? null,
      duracaoSegundos: s.elapsedSeconds,
      situacao: s.status,
    })),
  }

  const instruction = [
    'INSTRUÇÃO: Redija a minuta de ata desta sessão legislativa em português formal de ata,',
    'com as seções numeradas na ordem: 1. Abertura; 2. Verificação de Quórum e Presença;',
    '3. Expediente; 4. Ordem do Dia (com o resultado de cada matéria, quando houver);',
    '5. Discursos; 6. Encerramento.',
    'Cada seção deve ter título curto e texto corrido. Na Ordem do Dia, registre o resultado',
    'de cada matéria exatamente como informado no contexto. Em votações nominais, cite os',
    'votos por parlamentar. Não invente dados: use [CONFIRMAR] quando algo estiver ausente',
    '(por exemplo, horário de encerramento de sessão ainda não encerrada).',
    'Responda apenas com o JSON no formato especificado.',
  ].join(' ')

  const llm = await llmComplete(SYSTEM_PROMPT, `CONTEXTO (dados persistidos da sessão):\n${JSON.stringify(context, null, 2)}\n\n${instruction}`)

  const parsed = parseJsonFromLlm<Record<string, unknown>>(llm.text)

  // Normalização defensiva da saída (o modelo deve seguir o formato).
  const secoesRaw = Array.isArray(parsed.secoes) ? parsed.secoes : []
  const output: AtaDraftOutput = {
    titulo: typeof parsed.titulo === 'string' && parsed.titulo.trim() ? parsed.titulo.trim() : sessionLabel(session),
    secoes: secoesRaw
      .map((s) =>
        s && typeof s === 'object'
          ? {
              titulo: String((s as Record<string, unknown>).titulo ?? 'Seção'),
              texto: String((s as Record<string, unknown>).texto ?? '').trim(),
            }
          : null
      )
      .filter((s): s is { titulo: string; texto: string } => !!s && s.texto.length > 0),
    observacao:
      typeof parsed.observacao === 'string' && parsed.observacao.trim()
        ? parsed.observacao.trim()
        : 'Rascunho gerado por IA a partir dos dados persistidos — revisão humana obrigatória antes de qualquer uso oficial.',
  }

  const artifact: AiArtifact = await withTransaction(async (tx) =>
    persistAiArtifact(tx, {
      tenantId: session.tenantId,
      actor,
      kind: 'ata_draft',
      sessionId: session.id,
      input: { system: SYSTEM_PROMPT, contexto: context, instrucao: instruction },
      output: { ...output, aviso: 'Rascunho de IA — não é documento oficial' },
      model: llm.model,
      correlationId,
      ip: clientIp(req),
    })
  )

  return Response.json({ artifact: toAiArtifactView(artifact), output }, { status: 201 })
})
