/**
 * PATCH  /api/v1/webhooks/:id — {active?, events?, url?, description?} (RBAC
 * webhook.manage). Auditoria `webhook.updated`.
 * DELETE /api/v1/webhooks/:id — exclusão real (entregas em cascata) + auditoria
 * `webhook.deleted`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, assertTenantScope, type ResolvedActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { WEBHOOK_EVENT_TYPES, type WebhookEndpointView } from '@/lib/contracts'
import { isValidWebhookUrl, maskSecret, parseWebhookEvents } from '@/lib/server/webhooks'

export const dynamic = 'force-dynamic'

async function loadEndpoint(actorTenantCheck: ResolvedActor, id: string) {
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id } })
  if (!endpoint) throw notFound('Webhook não encontrado.')
  assertTenantScope(actorTenantCheck, endpoint.tenantId)
  return endpoint
}

function toView(
  e: {
    id: string
    url: string
    events: string
    description: string | null
    active: boolean
    secret: string
    createdAt: Date
    updatedAt: Date
  },
  deadCount: number
): WebhookEndpointView {
  return {
    id: e.id,
    url: e.url,
    events: parseWebhookEvents(e.events),
    description: e.description ?? null,
    active: e.active,
    secretMasked: maskSecret(e.secret),
    deadCount,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

const patchSchema = z.object({
  active: z.boolean().optional(),
  events: z.array(z.string().min(1)).min(1).optional(),
  url: z.string().min(1).optional(),
  description: z.string().max(300).nullable().optional(),
})

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'webhook.manage')
  const { id } = await ctx.params
  const endpoint = await loadEndpoint(actor, id)
  const body = patchSchema.parse(await req.json())

  if (body.events) {
    const invalid = body.events.filter(
      (t) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(t)
    )
    if (invalid.length > 0) {
      throw new DomainError(
        'WEBHOOK_INVALID_EVENT',
        400,
        'Evento não permitido',
        `EventType(s) inválido(s): ${invalid.join(', ')}. Allowlist: ${WEBHOOK_EVENT_TYPES.join(', ')}.`,
        { errors: { events: [`Eventos aceitos: ${WEBHOOK_EVENT_TYPES.join(', ')}.`] } }
      )
    }
  }
  if (body.url !== undefined && !isValidWebhookUrl(body.url.trim())) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'A URL do webhook deve ser http(s) válida.',
      { errors: { url: ['Informe uma URL http(s) válida.'] } }
    )
  }

  const updated = await withTransaction(async (tx) => {
    const next = await tx.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.events ? { events: JSON.stringify([...new Set(body.events)]) } : {}),
        ...(body.url !== undefined ? { url: body.url.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
      },
    })
    await writeAudit(tx, {
      tenantId: endpoint.tenantId,
      actor,
      action: 'webhook.updated',
      aggregateType: 'webhook',
      aggregateId: endpoint.id,
      summary: `Webhook atualizado: ${next.url}${body.active !== undefined ? ` (${body.active ? 'ativado' : 'desativado'})` : ''}.`,
      before: { url: endpoint.url, events: parseWebhookEvents(endpoint.events), active: endpoint.active },
      after: { url: next.url, events: parseWebhookEvents(next.events), active: next.active },
      correlationId,
      ip: clientIp(req),
    })
    return next
  })

  const deadCount = await db.webhookDelivery.count({
    where: { endpointId: updated.id, status: 'dead' },
  })
  return Response.json({ webhook: toView(updated, deadCount) })
})

export const DELETE = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'webhook.manage')
  const { id } = await ctx.params
  const endpoint = await loadEndpoint(actor, id)

  await withTransaction(async (tx) => {
    await tx.webhookDelivery.deleteMany({ where: { endpointId: endpoint.id } })
    await tx.webhookEndpoint.delete({ where: { id: endpoint.id } })
    await writeAudit(tx, {
      tenantId: endpoint.tenantId,
      actor,
      action: 'webhook.deleted',
      aggregateType: 'webhook',
      aggregateId: endpoint.id,
      summary: `Webhook excluído: ${endpoint.url} (${parseWebhookEvents(endpoint.events).join(', ')}).`,
      before: { url: endpoint.url, events: parseWebhookEvents(endpoint.events), active: endpoint.active },
      correlationId,
      ip: clientIp(req),
    })
  })

  return Response.json({ ok: true })
})
