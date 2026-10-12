/** Declaração auditada de observação da página pública por outra pessoa/dispositivo. */
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

const schema = z.object({
  destinationId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  videoOk: z.literal(true),
  audioOk: z.literal(true),
  evidenceNote: z.string().trim().min(10).max(500),
})

const view = (row: {
  id: string; destinationId: string; destinationGeneration: number; publicUrl: string; observerId: string; observerName: string;
  videoOk: boolean; audioOk: boolean; evidenceNote: string; observedAt: Date
}) => ({ id: row.id, destinationId: row.destinationId, destinationGeneration: row.destinationGeneration, publicUrl: row.publicUrl,
  observerId: row.observerId, observerName: row.observerName, videoOk: row.videoOk, audioOk: row.audioOk,
  evidenceNote: row.evidenceNote, observedAt: row.observedAt.toISOString() })

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.read')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const rows = await db.mediaPublicObservation.findMany({
    where: { tenantId: session.tenantId, sessionId: id }, orderBy: { observedAt: 'desc' }, take: 20,
  })
  return Response.json({ observations: rows.map(view) }, { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.manage')
  const { id } = await ctx.params
  const body = schema.parse(await req.json())
  const session = await loadSession(actor, id)
  const configured = (await loadMediaDestinations(session.tenantId)).find((item) => item.id === body.destinationId)
  if (!configured?.publicUrl) throw new DomainError('MEDIA_PUBLIC_URL_MISSING', 409, 'Link ausente', 'Configure a URL pública deste destino.')
  const [transmission, source, snapshot] = await Promise.all([
    db.transmission.findUnique({ where: { sessionId: id }, include: { destinationIntents: true } }),
    probeMediaSource(id),
    destinationSnapshot(session.tenantId, `session-${id}`),
  ])
  const intent = transmission?.destinationIntents.find((item) => item.destinationId === body.destinationId)
  const observed = snapshot.destinations.find((item) => item.id === body.destinationId)
  if (transmission?.status !== 'monitoring' || !source.ready || !intent?.desiredEnabled ||
      intent.syncStatus !== 'applied' || !observed?.enabled || observed.state !== 'forwarding') {
    throw new DomainError('MEDIA_PUBLIC_NOT_READY', 409, 'Destino não pronto', 'Confirme sinal e encaminhamento antes de registrar a observação externa.')
  }
  const row = await withTransaction(async (tx) => {
    const current = await tx.transmission.findUniqueOrThrow({ where: { id: transmission.id }, include: { destinationIntents: true } })
    const currentIntent = current.destinationIntents.find((item) => item.destinationId === body.destinationId)
    if (current.status !== 'monitoring' || !currentIntent?.desiredEnabled || currentIntent.syncStatus !== 'applied') {
      throw new DomainError('MEDIA_PUBLIC_NOT_READY', 409, 'Destino não pronto', 'O destino deixou de estar pronto durante a conferência.')
    }
    const created = await tx.mediaPublicObservation.create({ data: {
      tenantId: session.tenantId, sessionId: id, transmissionId: current.id,
      destinationId: body.destinationId, destinationGeneration: currentIntent.generation,
      publicUrl: configured.publicUrl!,
      observerId: actor.id, observerName: actor.name, videoOk: true, audioOk: true,
      evidenceNote: body.evidenceNote,
    } })
    await writeAudit(tx, { tenantId: session.tenantId, actor, action: 'transmission.public_observed',
      aggregateType: 'transmission', aggregateId: current.id,
      summary: `Página pública do destino ${body.destinationId} declarada com vídeo e áudio.`,
      after: { observationId: created.id, destinationId: body.destinationId, publicUrl: configured.publicUrl,
        evidenceNote: body.evidenceNote }, correlationId, ip: clientIp(req) })
    return created
  })
  return Response.json({ observation: view(row) }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
})
