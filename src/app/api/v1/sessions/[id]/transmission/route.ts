/** Acompanhamento local da mídia. Não inicia o encoder nem confirma destinos sociais. */
import type { NextRequest } from 'next/server'
import type { Transmission } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { nextTransmissionStatus, probeMediaSource, type SourceProbe, type TransmissionStatus } from '@/lib/server/media-status'
import { destinationSnapshot } from '@/lib/server/media-control'

export const dynamic = 'force-dynamic'

const commandSchema = z.object({
  action: z.enum(['prepare', 'start_monitoring', 'stop_monitoring']),
  version: z.number().int().min(1),
  idempotencyKey: z.string().min(8).max(128),
})

function view(row: Transmission | null, sessionId: string, source: SourceProbe, official: boolean) {
  const status = (row?.status ?? 'draft') as TransmissionStatus
  return {
    transmission: {
      id: row?.id ?? null,
      sessionId,
      official,
      status,
      effectiveStatus: status === 'monitoring' && !source.ready ? 'signal_lost' : status,
      version: row?.version ?? 1,
      startedAt: row?.startedAt?.toISOString() ?? null,
      endedAt: row?.endedAt?.toISOString() ?? null,
      publicLink: row?.publicUrl && row.publicDestinationId && row.publicPublishedAt
        ? { url: row.publicUrl, destinationId: row.publicDestinationId, publishedAt: row.publicPublishedAt.toISOString(),
          observationId: row.publicObservationId }
        : null,
    },
    source,
  }
}

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.read')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const [row, source] = await Promise.all([
    db.transmission.findUnique({ where: { sessionId: id } }),
    probeMediaSource(id),
  ])
  return Response.json(view(row, id, source, session.official), { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.manage')
  const { id } = await ctx.params
  const body = commandSchema.parse(await req.json())
  const session = await loadSession(actor, id)
  const source = await probeMediaSource(id)
  if (body.action === 'stop_monitoring') {
    const desired = await db.mediaDestinationIntent.count({ where: { transmission: { sessionId: id }, desiredEnabled: true } })
    if (desired) {
      throw new DomainError('MEDIA_DESTINATIONS_ACTIVE', 409, 'Destinos solicitados', 'Solicite a desativação e aguarde a confirmação de todos os destinos.')
    }
    const destinations = await destinationSnapshot(session.tenantId, source.path)
    if (destinations.destinations.some((destination) => destination.enabled)) {
      throw new DomainError('MEDIA_DESTINATIONS_ACTIVE', 409, 'Destinos ativos', 'Desative todos os destinos antes de encerrar o acompanhamento.')
    }
  }

  const result = await withTransaction(async (tx) => {
    const row = await tx.transmission.upsert({
      where: { sessionId: session.id },
      create: { tenantId: session.tenantId, sessionId: session.id, status: 'draft' },
      update: {},
    })
    const previous = await tx.transmissionCommand.findUnique({
      where: { transmissionId_idempotencyKey: { transmissionId: row.id, idempotencyKey: body.idempotencyKey } },
    })
    if (previous) {
      if (previous.action !== body.action) {
        throw new DomainError('MEDIA_DUPLICATE_COMMAND', 409, 'Comando duplicado', 'A chave de idempotência já foi usada para outra ação.')
      }
      return { row, replayed: true }
    }
    if (body.version !== row.version) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', `Versão informada (${body.version}) difere da atual (${row.version}). Recarregue o painel.`)
    }
    const next = nextTransmissionStatus(row.status as TransmissionStatus, body.action, source.ready)
    if (!next) {
      if (body.action === 'start_monitoring' && !source.ready) {
        throw new DomainError('MEDIA_SOURCE_UNAVAILABLE', 409, 'Sinal indisponível', 'A fonte local ainda não aparece como pronta no MediaMTX.')
      }
      throw new DomainError('MEDIA_INVALID_TRANSITION', 409, 'Transição inválida', `Ação ${body.action} não é permitida no estado ${row.status}.`)
    }
    const now = new Date()
    const updated = await tx.transmission.update({
      where: { id: row.id },
      data: {
        status: next,
        version: { increment: 1 },
        ...(body.action === 'start_monitoring' ? { startedAt: now, endedAt: null } : {}),
        ...(body.action === 'stop_monitoring' ? { endedAt: now } : {}),
      },
    })
    await tx.transmissionCommand.create({
      data: { transmissionId: row.id, idempotencyKey: body.idempotencyKey, action: body.action, version: updated.version },
    })
    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: `transmission.${body.action}`,
      aggregateType: 'transmission',
      aggregateId: row.id,
      summary: `Acompanhamento local: ${row.status} → ${next}.`,
      before: { status: row.status, version: row.version },
      after: { status: next, version: updated.version, sourceReady: source.ready },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'transmission.state_changed',
      aggregateId: row.id,
      sessionId: session.id,
      aggregateVersion: updated.version,
      correlationId,
      internalPayload: { sessionId: session.id, from: row.status, to: next },
    })
    return { row: updated, replayed: false }
  })
  return Response.json({ ...view(result.row, id, source, session.official), replayed: result.replayed }, { headers: { 'Cache-Control': 'no-store' } })
})
