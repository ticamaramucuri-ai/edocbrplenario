/** Vídeo local publicado, com escopo de Câmara e suporte a Range. */
import type { NextRequest } from 'next/server'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { verifyReplayFile } from '@/lib/server/recording-archive'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))
  const row = await db.sessionRecording.findUnique({ where: { sessionId: id } })
  if (!row || row.tenantId !== tenant.id || row.status !== 'published' || (row.expiresAt && row.expiresAt <= new Date())) throw notFound('Replay não publicado nesta Câmara.')
  const path = await verifyReplayFile(tenant.id, id, row.replayBytes, row.replaySha256)
  const size = Number(row.replayBytes)
  if (!Number.isSafeInteger(size)) throw notFound('Replay indisponível.')
  const common = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ETag: `"${row.replaySha256}"` }
  const range = req.headers.get('range')
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range)
    if (!match) return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${size}` } })
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${size}` } })
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream, { status: 206, headers: { ...common, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } })
  }
  return new Response(Readable.toWeb(createReadStream(path)) as unknown as ReadableStream, { headers: { ...common, 'Content-Length': String(size) } })
})
