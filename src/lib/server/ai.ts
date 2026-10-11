/**
 * Cliente da IA assistiva (Fase 7) — z-ai-web-dev-sdk SOMENTE server-side.
 *
 * Regras invioláveis (prompt mestre 7.13 / ADR-006):
 * - todo artefato é RASCUNHO até revisão humana explícita;
 * - a IA nunca vota, publica, aprova ou altera estado de domínio;
 * - chamadas ao SDK têm timeout de 60s (504 AI_TIMEOUT);
 * - falha do provedor → Problem Details 502 AI_PROVIDER_ERROR.
 */
import ZAI from 'z-ai-web-dev-sdk'
import { DomainError } from './errors'

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>> & {
  chat: {
    completions: {
      create: (body: Record<string, unknown>) => Promise<unknown>
      createVision: (body: Record<string, unknown>) => Promise<unknown>
    }
  }
  audio: {
    asr: { create: (body: Record<string, unknown>) => Promise<unknown> }
  }
}

/** Formato mínimo que consumimos das respostas do SDK (tipado localmente). */
type ChatCompletionLike = {
  model?: unknown
  choices?: Array<{ message?: { content?: unknown } }>
}
type AsrLike = { text?: unknown }

const AI_TIMEOUT_MS = 60_000

let zaiSingleton: ZaiClient | null = null

function aiProviderError(err: unknown): DomainError {
  const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : 'erro desconhecido'
  return new DomainError(
    'AI_PROVIDER_ERROR',
    502,
    'Provedor de IA indisponível',
    `Falha na comunicação com o provedor de IA (z-ai): ${detail.slice(0, 240)}`
  )
}

function aiTimeoutError(): DomainError {
  return new DomainError(
    'AI_TIMEOUT',
    504,
    'Tempo excedido na geração por IA',
    `A geração com assistência de IA excedeu ${AI_TIMEOUT_MS / 1000}s e foi cancelada. Tente novamente.`
  )
}

async function getZai(): Promise<ZaiClient> {
  if (!zaiSingleton) {
    try {
      zaiSingleton = (await ZAI.create()) as ZaiClient
    } catch (err) {
      throw aiProviderError(err)
    }
  }
  return zaiSingleton
}

/** Promise.race com cancelamento do timer — 504 AI_TIMEOUT quando estoura. */
async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(aiTimeoutError()), AI_TIMEOUT_MS)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const modelOf = (raw: unknown, fallback: string): string =>
  typeof raw === 'string' && raw.trim() ? raw.trim() : fallback

const contentOf = (raw: unknown, what: string): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw aiProviderError(new Error(`resposta vazia do modelo (${what})`))
  }
  return raw
}

export type LlmResult = { text: string; model: string }

/** LLM (chat completion) com system+user, thinking desabilitado. */
export async function llmComplete(system: string, user: string): Promise<LlmResult> {
  const zai = await getZai()
  try {
    const completion = (await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
    )) as ChatCompletionLike
    return {
      text: contentOf(completion.choices?.[0]?.message?.content, 'chat'),
      model: modelOf(completion.model, 'glm-4.6'),
    }
  } catch (err) {
    if (err instanceof DomainError) throw err
    throw aiProviderError(err)
  }
}

/** ASR — transcrição de áudio (base64 SEM prefixo data:). */
export async function transcribeAudio(base64: string): Promise<{ text: string; model: string }> {
  const zai = await getZai()
  try {
    const response = (await withTimeout(zai.audio.asr.create({ file_base64: base64 }))) as AsrLike
    return { text: contentOf(response.text, 'asr'), model: 'glm-asr' }
  } catch (err) {
    if (err instanceof DomainError) throw err
    throw aiProviderError(err)
  }
}

/** VLM — extração a partir de imagem (OCR) com prompt textual. */
export async function visionExtract(
  base64: string,
  mime: string,
  prompt: string
): Promise<{ text: string; model: string }> {
  const zai = await getZai()
  try {
    const completion = (await withTimeout(
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      })
    )) as ChatCompletionLike
    return {
      text: contentOf(completion.choices?.[0]?.message?.content, 'vision'),
      model: modelOf(completion.model, 'glm-4.6v'),
    }
  } catch (err) {
    if (err instanceof DomainError) throw err
    throw aiProviderError(err)
  }
}

/**
 * Extrai o primeiro objeto JSON da resposta do LLM — tolera cercas ```json,
 * texto antes/depois e aspas smart quotes. Lança 502 AI_PROVIDER_ERROR se a
 * saída não puder ser interpretada.
 */
export function parseJsonFromLlm<T>(text: string): T {
  const cleaned = text
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/i, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
  const candidates = cleaned.startsWith('{') ? [cleaned] : []
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // tenta o próximo candidato
    }
  }
  throw aiProviderError(new Error('a resposta do modelo não veio em JSON válido'))
}
