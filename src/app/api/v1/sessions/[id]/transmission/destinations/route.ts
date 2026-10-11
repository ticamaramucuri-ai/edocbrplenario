/** Intenção durável de encaminhamento. O worker aplica e verifica no MediaMTX. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { destinationSnapshot, loadMediaDestinations } from '@/lib/server/media-control'
import { probeMediaSource } from '@/lib/server/media-status'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const commandSchema = z.object({
  destinationId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  enabled: z.boolean(),
})

async function view(tenantId: string, sessionId: string) {
  const configured = await loadMediaDestinations(tenantId)
  const intents = await db.mediaDestinationIntent.findMany({ where: { transmission: { sessionId } } })
  let controllerAvailable = true
  let controllerErrorCode: string | null = null
  let observed: Awaited<ReturnType<typeof destinationSnapshot>> | null = null
  if (configured.length) {
    try { observed = await destinationSnapshot(tenantId, `session-${sessionId}`) }
    catch (error) {
      controllerAvailable = false
      controllerErrorCode = error instanceof DomainError ? error.code : 'MEDIA_CONTROL_UNAVAILABLE'
    }
  }
  return {
    configured: Boolean(process.env.MEDIA_DESTINATIONS_FILE),
    controllerAvailable,
    controllerErrorCode,
    destinations: configured.map((item) => {
      const actual = observed?.destinations.find((destination) => destination.id === item.id)
      const intent = intents.find((entry) => entry.destinationId === item.id)
      return {
        id: item.id,
        label: item.label,
        platform: item.platform,
        hasPublicUrl: Boolean(item.publicUrl),
        enabled: actual?.enabled ?? null,
        state: actual?.state ?? 'unknown',
        outboundBytes: actual?.outboundBytes ?? null,
        desiredEnabled: intent?.desiredEnabled ?? false,
        syncStatus: intent?.syncStatus === 'applied' && actual && actual.enabled !== intent.desiredEnabled
          ? 'pending'
          : intent?.syncStatus ?? 'unmanaged',
        lastErrorCode: intent?.lastErrorCode ?? null,
      }
    }),
  }
}

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.read')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  return Response.json(await view(session.tenantId, id), { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.manage')
  const { id } = await ctx.params
  const body = commandSchema.parse(await req.json())
  const session = await loadSession(actor, id)
  if (!(await loadMediaDestinations(session.tenantId)).some((item) => item.id === body.destinationId)) {
    throw new DomainError('MEDIA_DESTINATION_NOT_FOUND', 404, 'Destino não encontrado', 'Destino não está configurado para esta Câmara.')
  }
  if (body.enabled) {
    const [transmission, source] = await Promise.all([
      db.transmission.findUnique({ where: { sessionId: id } }),
      probeMediaSource(id),
    ])
    if (transmission?.status !== 'monitoring' || !source.ready) {
      throw new DomainError('MEDIA_SOURCE_UNAVAILABLE', 409, 'Sinal não confirmado', 'Confirme o sinal local antes de ativar um destino.')
    }
  }
  await withTransaction(async (tx) => {
    const transmission = await tx.transmission.upsert({
      where: { sessionId: id },
      create: { tenantId: session.tenantId, sessionId: id, status: 'draft' },
      update: {},
    })
    const intent = await tx.mediaDestinationIntent.upsert({
      where: { transmissionId_destinationId: { transmissionId: transmission.id, destinationId: body.destinationId } },
      create: { transmissionId: transmission.id, destinationId: body.destinationId, desiredEnabled: body.enabled },
      update: {},
    })
    if (intent.desiredEnabled !== body.enabled || intent.syncStatus === 'error') {
      await tx.mediaDestinationIntent.update({
        where: { id: intent.id },
        data: {
          desiredEnabled: body.enabled,
          generation: { increment: 1 },
          syncStatus: 'pending',
          attempts: 0,
          lastErrorCode: null,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseUntil: null,
        },
      })
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'transmission.destination_requested',
      aggregateType: 'transmission',
      aggregateId: transmission.id,
      summary: `Destino ${body.destinationId}: estado desejado ${body.enabled ? 'ativo' : 'inativo'}.`,
      after: { destinationId: body.destinationId, enabled: body.enabled },
      correlationId,
      ip: clientIp(req),
    })
  })
  return Response.json(await view(session.tenantId, id), { status: 202, headers: { 'Cache-Control': 'no-store' } })
})
