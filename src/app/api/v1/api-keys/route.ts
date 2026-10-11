/**
 * GET  /api/v1/api-keys — lista as chaves do tenant do ator (RBAC
 * `apikey.manage`, tenant_admin; escopo = actor.tenantId), ordenadas por
 * createdAt desc. A view NUNCA inclui hash nem segredo.
 * POST /api/v1/api-keys — {name, scopes} → gera `legk_` + 24 chars
 * (crypto randomInt), persiste prefix (legk_+8) + sha256(chave) + scopes JSON.
 * A chave COMPLETA é devolvida UMA única vez (nunca persistida nem logada).
 * Auditoria `apikey.created` (summary com nome+escopos, SEM a chave).
 */
import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { generateApiKeySecret, toApiKeyView } from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome da chave (1–60 caracteres).')
    .max(60, 'O nome da chave deve ter no máximo 60 caracteres.'),
  scopes: z
    .array(
      z.enum(['matters.read', 'sessions.read', 'publications.read', 'calendar.read'] as const)
    )
    .min(1, 'Selecione ao menos 1 escopo.'),
})

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'apikey.manage')
  const tenantId = await resolveTenantScope(req, actor)

  const keys = await db.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({ keys: keys.map(toApiKeyView) })
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'apikey.manage')
  const tenantId = await resolveTenantScope(req, actor)

  const body = createSchema.parse(await req.json())

  // Chave completa gerada AQUI e devolvida UMA vez: do servidor sai apenas no
  // corpo da resposta — persiste só o prefixo (legk_+8 exibíveis) e o sha256.
  const secret = generateApiKeySecret()
  const key = await withTransaction(async (tx) => {
    const created = await tx.apiKey.create({
      data: {
        tenantId,
        name: body.name,
        prefix: secret.slice(0, 13),
        hash: createHash('sha256').update(secret).digest('hex'),
        scopes: JSON.stringify(body.scopes),
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'apikey.created',
      aggregateType: 'api_key',
      aggregateId: created.id,
      summary: `Chave de API criada: ${created.name} (${created.prefix}…) — escopos: ${body.scopes.join(', ')}.`,
      after: { name: created.name, prefix: created.prefix, scopes: body.scopes },
      correlationId,
      ip: clientIp(req),
    })
    return created
  })

  return Response.json({ key: toApiKeyView(key), secret })
})
