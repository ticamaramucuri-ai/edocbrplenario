/**
 * GET|POST /api/v1/webhooks — endpoints de integração do tenant.
 * GET liberado a todos os atores do tenant (escopo); POST (criação) exige
 * `webhook.manage` (tenant_admin). POST valida URL http(s) e aceita apenas
 * eventTypes da allowlist (WEBHOOK_EVENT_TYPES em contracts) — eventos
 * inválidos → 400 WEBHOOK_INVALID_EVENT. Auditoria `webhook.created`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { WEBHOOK_EVENT_TYPES, type WebhookEndpointView } from '@/lib/contracts'
import {
  generateWebhookSecret,
  isValidWebhookUrl,
  maskSecret,
  parseWebhookEvents,
} from '@/lib/server/webhooks'

export const dynamic = 'force-dynamic'

function toEndpointView(
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

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)

  const endpoints = await db.webhookEndpoint.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    include: { deliveries: { where: { status: 'dead' }, select: { id: true } } },
  })

  return Response.json({
    webhooks: endpoints.map((e) => toEndpointView(e, e.deliveries.length)),
    allowedEvents: WEBHOOK_EVENT_TYPES,
  })
})

const createSchema = z.object({
  url: z.string().min(1, 'URL obrigatória.'),
  events: z.array(z.string().min(1)).min(1, 'Informe ao menos 1 evento.'),
  description: z.string().max(300).optional().nullable(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'webhook.manage')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())

  const url = body.url.trim()
  if (!isValidWebhookUrl(url)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'A URL do webhook deve ser http(s) válida.',
      { errors: { url: ['Informe uma URL http(s) válida.'] } }
    )
  }

  const invalid = body.events.filter((t) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(t))
  if (invalid.length > 0) {
    throw new DomainError(
      'WEBHOOK_INVALID_EVENT',
      400,
      'Evento não permitido',
      `EventType(s) inválido(s): ${invalid.join(', ')}. Allowlist: ${WEBHOOK_EVENT_TYPES.join(', ')}.`,
      { errors: { events: [`Eventos aceitos: ${WEBHOOK_EVENT_TYPES.join(', ')}.`] } }
    )
  }

  const created = await withTransaction(async (tx) => {
    const endpoint = await tx.webhookEndpoint.create({
      data: {
        tenantId,
        url,
        secret: generateWebhookSecret(),
        events: JSON.stringify([...new Set(body.events)]),
        description: body.description?.trim() ?? null,
        active: true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'webhook.created',
      aggregateType: 'webhook',
      aggregateId: endpoint.id,
      summary: `Webhook criado: ${url} (${parseWebhookEvents(endpoint.events).join(', ')}).`,
      after: { url, events: parseWebhookEvents(endpoint.events), active: true },
      correlationId,
      ip: clientIp(req),
    })
    return endpoint
  })

  return Response.json({ webhook: toEndpointView(created, 0) }, { status: 201 })
})
