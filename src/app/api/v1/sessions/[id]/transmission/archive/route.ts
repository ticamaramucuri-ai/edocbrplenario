/** Preparação e publicação explícita do replay local de uma sessão encerrada. */
import type { NextRequest } from 'next/server'
import type { SessionRecording } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { tenantSettings } from '@/lib/server/domain'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { buildRecordingArchive, verifySourceManifest, verifyReplayFile, type RecordingManifest } from '@/lib/server/recording-archive'

export const dynamic = 'force-dynamic'

const schema = z.object({
  action: z.enum(['build', 'publish', 'withdraw']),
  version: z.number().int().min(1),
  idempotencyKey: z.string().min(8).max(128),
  gapJustification: z.string().trim().min(10).max(1000).optional(),
})

function view(row: SessionRecording | null) {
  if (!row) return { recording: null }
  const manifest = JSON.parse(row.manifestJson) as RecordingManifest
  return { recording: {
    id: row.id, sessionId: row.sessionId, status: row.status, version: row.version,
    manifestSha256: row.manifestSha256, replaySha256: row.replaySha256,
    replayBytes: row.replayBytes.toString(), durationSeconds: row.durationSeconds,
    gapCount: row.gapCount, segmentCount: manifest.segments.length,
    segments: manifest.segments, verifiedAt: row.verifiedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  } }
}

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.read')
  const { id } = await ctx.params
  await loadSession(actor, id)
  const row = await db.sessionRecording.findUnique({ where: { sessionId: id } })
  let integrity: 'valid' | 'invalid' | null = null
  if (row && req.nextUrl.searchParams.get('verify') === '1') {
    try {
      await verifyReplayFile(row.tenantId, id, row.replayBytes, row.replaySha256)
      await verifySourceManifest(id, row.manifestJson, row.manifestSha256)
      integrity = 'valid'
    } catch { integrity = 'invalid' }
  }
  return Response.json({ ...view(row), integrity }, { headers: { 'Cache-Control': 'no-store' } })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.manage')
  const { id } = await ctx.params
  const body = schema.parse(await req.json())
  const session = await loadSession(actor, id)
  const previous = await db.sessionRecording.findUnique({ where: { sessionId: id } })
  if (previous) {
    const prior = await db.recordingCommand.findUnique({ where: { recordingId_idempotencyKey: { recordingId: previous.id, idempotencyKey: body.idempotencyKey } } })
    if (prior) {
      if (prior.action !== body.action) throw new DomainError('MEDIA_DUPLICATE_COMMAND', 409, 'Comando duplicado', 'Chave de idempotência já usada para outra ação.')
      return Response.json({ ...view(previous), replayed: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
  }
  if ((previous?.version ?? 1) !== body.version) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'Recarregue o painel da gravação.')

  let built: Awaited<ReturnType<typeof buildRecordingArchive>> | null = null
  if (body.action === 'build') {
    if (session.status !== 'closed' || previous?.status === 'published') throw new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Estado inválido', 'Encerre a sessão e retire um replay já publicado antes de preparar uma nova versão.')
    const transmission = await db.transmission.findUnique({ where: { sessionId: id } })
    if (transmission?.status !== 'ended') throw new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Transmissão ativa', 'Encerre o acompanhamento de mídia antes de preparar o replay.')
    built = await buildRecordingArchive(session.tenantId, id)
  } else {
    if (!previous) throw new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Replay ausente', 'Prepare a gravação antes de publicar ou retirar o replay.')
    if (body.action === 'publish') {
      if (previous.status === 'published') throw new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Replay publicado', 'O replay já está publicado.')
      if (previous.gapCount > 0 && !body.gapJustification) throw new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Lacunas detectadas', 'Informe justificativa para publicar uma gravação com lacunas.')
      await verifyReplayFile(session.tenantId, id, previous.replayBytes, previous.replaySha256)
      await verifySourceManifest(id, previous.manifestJson, previous.manifestSha256)
    } else if (previous.status !== 'published') throw new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Replay não publicado', 'Não há replay público para retirar.')
  }
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: session.tenantId } })
  const activeCount = await db.parliamentarian.count({ where: { tenantId: session.tenantId, active: true } })
  const visibilityDays = tenantSettings(tenant, activeCount).replayVisibilityDays

  const row = await withTransaction(async (tx) => {
    const current = await tx.sessionRecording.findUnique({ where: { sessionId: id } })
    if ((current?.version ?? 1) !== body.version || (current?.status === 'published' && body.action === 'build')) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'Recarregue o painel da gravação.')
    const now = new Date()
    const updated = body.action === 'build'
      ? await tx.sessionRecording.upsert({
          where: { sessionId: id },
          create: { tenantId: session.tenantId, sessionId: id, manifestJson: JSON.stringify(built!.manifest), manifestSha256: built!.manifestSha256, replaySha256: built!.replaySha256, replayBytes: built!.replayBytes, durationSeconds: built!.durationSeconds, gapCount: built!.gapCount, verifiedAt: now },
          update: { status: 'verified', version: { increment: 1 }, manifestJson: JSON.stringify(built!.manifest), manifestSha256: built!.manifestSha256, replaySha256: built!.replaySha256, replayBytes: built!.replayBytes, durationSeconds: built!.durationSeconds, gapCount: built!.gapCount, verifiedAt: now, publishedAt: null, expiresAt: null },
        })
      : await tx.sessionRecording.update({
          where: { id: current!.id, version: body.version },
          data: body.action === 'publish'
            ? { status: 'published', version: { increment: 1 }, publishedAt: now, expiresAt: visibilityDays ? new Date(now.getTime() + visibilityDays * 86_400_000) : null }
            : { status: 'withdrawn', version: { increment: 1 }, publishedAt: null, expiresAt: null },
        })
    await tx.recordingCommand.create({ data: { recordingId: updated.id, idempotencyKey: body.idempotencyKey, action: body.action, version: updated.version } })
    await writeAudit(tx, {
      tenantId: session.tenantId, actor, action: `recording.${body.action}`, aggregateType: 'session_recording', aggregateId: updated.id,
      summary: body.action === 'build' ? `Replay verificado: ${built!.manifest.segments.length} segmentos, ${built!.gapCount} lacuna(s).` : body.action === 'publish' ? 'Replay local publicado.' : 'Replay local retirado.',
      before: current ? { status: current.status, version: current.version, manifestSha256: current.manifestSha256 } : null,
      after: { status: updated.status, version: updated.version, manifestSha256: updated.manifestSha256, replaySha256: updated.replaySha256, gapCount: updated.gapCount, expiresAt: updated.expiresAt },
      justification: body.gapJustification ?? null, correlationId, ip: clientIp(req),
    })
    await emitOutbox(tx, { tenantId: session.tenantId, eventType: 'transmission.state_changed', aggregateId: updated.id, sessionId: id, aggregateVersion: updated.version, correlationId, internalPayload: { sessionId: id, recordingAction: body.action, recordingStatus: updated.status } })
    return updated
  })
  return Response.json({ ...view(row), replayed: false }, { headers: { 'Cache-Control': 'no-store' } })
})
