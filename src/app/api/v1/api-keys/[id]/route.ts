/**
 * DELETE /api/v1/api-keys/:id — revogação append-only (RBAC `apikey.manage`,
 * escopo = actor.tenantId). Só chaves do tenant do ator (senão 404).
 * Idempotente: chave já revogada → 200 com a key (sem nova auditoria).
 * Auditoria `apikey.revoked` somente na transição efetiva.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { parseApiScopes, toApiKeyView } from '@/lib/server/external-auth'

export const dynamic = 'force-dynamic'

export const DELETE = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'apikey.manage')
  const tenantId = await resolveTenantScope(req, actor)

  const { id } = await ctx.params
  const key = await db.apiKey.findUnique({ where: { id } })
  if (!key || key.tenantId !== tenantId) {
    throw notFound('Chave de API não encontrada.')
  }

  // Idempotente: já revogada → 200 com o estado atual (append-only, sem regravar).
  if (key.revokedAt) {
    return Response.json({ key: toApiKeyView(key) })
  }

  const revoked = await withTransaction(async (tx) => {
    const updated = await tx.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    })
    await writeAudit(tx, {
      tenantId: key.tenantId,
      actor,
      action: 'apikey.revoked',
      aggregateType: 'api_key',
      aggregateId: key.id,
      summary: `Chave de API revogada: ${key.name} (${key.prefix}…) — escopos: ${parseApiScopes(key.scopes).join(', ')}.`,
      before: { name: key.name, prefix: key.prefix, revokedAt: null },
      after: { name: updated.name, prefix: updated.prefix, revokedAt: updated.revokedAt?.toISOString() ?? null },
      correlationId,
      ip: clientIp(req),
    })
    return updated
  })

  return Response.json({ key: toApiKeyView(revoked) })
})
