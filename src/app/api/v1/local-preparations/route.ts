/** Paginated list of published sessions visible only to a designated local server. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = apiHandler(async (req: NextRequest) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  await authenticateLocalDeviceRequest(req, tenantId)
  const cursor = new URL(req.url).searchParams.get('cursor')
  if (cursor && (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    throw notFound('Página de preparação não encontrada.')
  }
  if (cursor && !(await db.session.findFirst({ where: { id: cursor, tenantId }, select: { id: true } }))) {
    throw notFound('Página de preparação não encontrada.')
  }
  const sessions = await db.session.findMany({
    where: { tenantId, status: 'scheduled', agendaPublished: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 101,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, number: true, year: true, scheduledAt: true, updatedAt: true,
      agendaRevisions: { orderBy: { revision: 'desc' }, take: 1,
        select: { id: true, revision: true, matterManifestJson: true, transferContextJson: true } } },
  })
  const page = sessions.slice(0, 100)
  return Response.json({ sessions: page.map((session) => ({
    id: session.id, number: session.number, year: session.year,
    scheduledAt: session.scheduledAt, updatedAt: session.updatedAt,
    revisionId: session.agendaRevisions[0]?.id ?? null,
    revisionNumber: session.agendaRevisions[0]?.revision ?? null,
    readyForTransfer: Boolean(session.agendaRevisions[0]?.matterManifestJson && session.agendaRevisions[0]?.transferContextJson),
  })), nextCursor: sessions.length > 100 ? page.at(-1)?.id : null },
  { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
})
