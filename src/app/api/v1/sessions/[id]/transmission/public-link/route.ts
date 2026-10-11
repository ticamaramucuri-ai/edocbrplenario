/** Publicação manual do link público, após conferência humana da live na plataforma. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { loadMediaDestinations, destinationSnapshot } from '@/lib/server/media-control'
import { probeMediaSource } from '@/lib/server/media-status'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'

export const dynamic = 'force-dynamic'

const schema = z.object({
  action: z.enum(['publish', 'withdraw']),
  version: z.number().int().min(1),
  idempotencyKey: z.string().min(8).max(128),
  destinationId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).optional(),
  platformConfirmed: z.boolean().optional(),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.manage')
  const { id } = await ctx.params
  const body = schema.parse(await req.json())
  const session = await loadSession(actor, id)
  const existing = await db.transmission.findUnique({ where: { sessionId: id } })
  if (existing) {
    const prior = await db.transmissionCommand.findUnique({ where: { transmissionId_idempotencyKey: { transmissionId: existing.id, idempotencyKey: body.idempotencyKey } } })
    if (prior) {
      if (prior.action !== `public_link.${body.action}`) throw new DomainError('MEDIA_DUPLICATE_COMMAND', 409, 'Comando duplicado', 'A chave de idempotência já foi usada para outra ação.')
      const source = await probeMediaSource(id)
      return Response.json({ transmission: {
        id: existing.id, sessionId: id, status: existing.status,
        effectiveStatus: existing.status === 'monitoring' && !source.ready ? 'signal_lost' : existing.status,
        version: existing.version, startedAt: existing.startedAt?.toISOString() ?? null,
        endedAt: existing.endedAt?.toISOString() ?? null,
        publicLink: existing.publicUrl && existing.publicDestinationId && existing.publicPublishedAt
          ? { url: existing.publicUrl, destinationId: existing.publicDestinationId, publishedAt: existing.publicPublishedAt.toISOString() } : null,
      }, source, replayed: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
  }
  let url: string | null = null
  if (body.action === 'publish') {
    if (!body.destinationId || body.platformConfirmed !== true) {
      throw new DomainError('MEDIA_PUBLIC_CONFIRMATION_REQUIRED', 409, 'Confirmação necessária', 'Confira vídeo e áudio na plataforma antes de publicar o link.')
    }
    const configured = (await loadMediaDestinations(session.tenantId)).find((item) => item.id === body.destinationId)
    if (!configured?.publicUrl) {
      throw new DomainError('MEDIA_PUBLIC_URL_MISSING', 409, 'Link ausente', 'Cadastre a URL pública do evento no arquivo privado de destinos desta Câmara.')
    }
    const [transmission, source, snapshot] = await Promise.all([
      db.transmission.findUnique({ where: { sessionId: id }, include: { destinationIntents: true } }),
      probeMediaSource(id),
      destinationSnapshot(session.tenantId, `session-${id}`),
    ])
    const intent = transmission?.destinationIntents.find((item) => item.destinationId === body.destinationId)
    const observed = snapshot.destinations.find((item) => item.id === body.destinationId)
    if (transmission?.status !== 'monitoring' || !source.ready || !intent?.desiredEnabled || intent.syncStatus !== 'applied' || !observed?.enabled || observed.state !== 'forwarding') {
      throw new DomainError('MEDIA_PUBLIC_NOT_READY', 409, 'Destino não pronto', 'Aguarde sinal local, reconciliação aplicada e saída RTMPS em encaminhamento.')
    }
    url = configured.publicUrl
  }

  const result = await withTransaction(async (tx) => {
    const row = await tx.transmission.findUnique({ where: { sessionId: id } })
    if (!row) throw new DomainError('MEDIA_TRANSMISSION_MISSING', 409, 'Transmissão ausente', 'Prepare o acompanhamento da transmissão antes de publicar o link.')
    const previous = await tx.transmissionCommand.findUnique({ where: { transmissionId_idempotencyKey: { transmissionId: row.id, idempotencyKey: body.idempotencyKey } } })
    const command = `public_link.${body.action}`
    if (previous) {
      if (previous.action !== command) throw new DomainError('MEDIA_DUPLICATE_COMMAND', 409, 'Comando duplicado', 'A chave de idempotência já foi usada para outra ação.')
      return { row, replayed: true }
    }
    if (row.version !== body.version) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'Recarregue o painel da transmissão.')
    if (body.action === 'publish') {
      const intent = await tx.mediaDestinationIntent.findUnique({ where: { transmissionId_destinationId: { transmissionId: row.id, destinationId: body.destinationId! } } })
      if (row.status !== 'monitoring' || !intent?.desiredEnabled || intent.syncStatus !== 'applied') {
        throw new DomainError('MEDIA_PUBLIC_NOT_READY', 409, 'Destino não pronto', 'O destino deixou de estar pronto durante a publicação.')
      }
    }
    if (body.action === 'withdraw' && !row.publicUrl) throw new DomainError('MEDIA_PUBLIC_LINK_MISSING', 409, 'Link ausente', 'Não há link publicado para retirar.')
    const updated = await tx.transmission.update({
      where: { id: row.id, version: row.version },
      data: {
        version: { increment: 1 },
        publicUrl: url,
        publicDestinationId: body.action === 'publish' ? body.destinationId : null,
        publicPublishedAt: body.action === 'publish' ? new Date() : null,
      },
    })
    await tx.transmissionCommand.create({ data: { transmissionId: row.id, idempotencyKey: body.idempotencyKey, action: command, version: updated.version } })
    await writeAudit(tx, {
      tenantId: session.tenantId, actor, action: `transmission.${command}`,
      aggregateType: 'transmission', aggregateId: row.id,
      summary: body.action === 'publish' ? `Link público do destino ${body.destinationId} confirmado e publicado.` : 'Link público retirado.',
      before: { publicUrl: row.publicUrl, destinationId: row.publicDestinationId },
      after: { publicUrl: updated.publicUrl, destinationId: updated.publicDestinationId, platformConfirmed: body.action === 'publish' },
      correlationId, ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId: session.tenantId, eventType: 'transmission.state_changed', aggregateId: row.id,
      sessionId: id, aggregateVersion: updated.version, correlationId,
      internalPayload: { sessionId: id, action: command, destinationId: updated.publicDestinationId },
    })
    return { row: updated, replayed: false }
  })
  const source = await probeMediaSource(id)
  return Response.json({
    transmission: {
      id: result.row.id, sessionId: id, status: result.row.status,
      effectiveStatus: result.row.status === 'monitoring' && !source.ready ? 'signal_lost' : result.row.status,
      version: result.row.version,
      startedAt: result.row.startedAt?.toISOString() ?? null, endedAt: result.row.endedAt?.toISOString() ?? null,
      publicLink: result.row.publicUrl && result.row.publicDestinationId && result.row.publicPublishedAt
        ? { url: result.row.publicUrl, destinationId: result.row.publicDestinationId, publishedAt: result.row.publicPublishedAt.toISOString() }
        : null,
    },
    source, replayed: result.replayed,
  }, { headers: { 'Cache-Control': 'no-store' } })
})
