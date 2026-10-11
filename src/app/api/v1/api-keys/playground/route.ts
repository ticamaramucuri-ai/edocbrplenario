/**
 * POST /api/v1/api-keys/playground — {keyId, endpoint} (RBAC `apikey.manage`).
 * Valida: keyId do tenant do ator + chave ATIVA (revokedAt null) + endpoint ∈
 * 4 externos + escopo correspondente na chave (senão 403 FORBIDDEN_SCOPE).
 *
 * Executa a consulta REAL por DELEGAÇÃO ASSINADA (ADR-024): minta
 * `deleg_<b64url({keyId, tenantId, scopes, exp:+30s})>.<hmac-sha256(secret)>`
 * e faz fetch server-side na porta interna 3000 (NÃO via gateway). A chave
 * real nunca vai ao browser e não é reconstruída (só o hash existe no banco).
 * Resposta: { result: { status, latencyMs, body } }.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import {
  EXTERNAL_ENDPOINT_SCOPE,
  mintDelegationToken,
  parseApiScopes,
} from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

/** Porta interna do dev server (fetch server-side — nunca via gateway). */
const INTERNAL_ORIGIN = 'http://localhost:3000'

const playgroundSchema = z.object({
  keyId: z.string().min(1, 'Selecione a chave de API.'),
  endpoint: z.string().min(1, 'Selecione o endpoint.'),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'apikey.manage')
  const tenantId = await resolveTenantScope(req, actor)

  const body = playgroundSchema.parse(await req.json())

  const requiredScope = EXTERNAL_ENDPOINT_SCOPE[body.endpoint]
  if (!requiredScope) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Endpoint não disponível no playground. Use um dos 4 endpoints externos.',
      { errors: { endpoint: ['Endpoints aceitos: /api/v1/external/matters, /sessions, /publications, /calendar.'] } }
    )
  }

  const key = await db.apiKey.findUnique({ where: { id: body.keyId } })
  if (!key || key.tenantId !== tenantId) {
    throw notFound('Chave de API não encontrada.')
  }
  if (key.revokedAt) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'A chave selecionada está revogada — selecione uma chave ativa.',
      { errors: { keyId: ['Selecione uma chave ativa (não revogada).'] } }
    )
  }

  const scopes = parseApiScopes(key.scopes)
  if (!scopes.includes(requiredScope)) {
    throw new DomainError(
      'FORBIDDEN_SCOPE',
      403,
      'Escopo insuficiente',
      `A chave não possui o escopo "${requiredScope}" exigido por este endpoint.`
    )
  }

  // Delegação assinada de 30s: a consulta roda com o contexto da chave sem
  // reconstruí-la — o token leva keyId/tenantId/scopes assinados com HMAC.
  const delegToken = mintDelegationToken(key.id, key.tenantId, scopes)

  const started = performance.now()
  const res = await fetch(`${INTERNAL_ORIGIN}${body.endpoint}`, {
    headers: { Authorization: `Bearer ${delegToken}` },
    cache: 'no-store',
  })
  const latencyMs = Math.max(0, Math.round(performance.now() - started))

  const text = await res.text()
  let responseBody: unknown = null
  if (text) {
    try {
      responseBody = JSON.parse(text)
    } catch {
      responseBody = text
    }
  }

  return Response.json({ result: { status: res.status, latencyMs, body: responseBody } })
})
