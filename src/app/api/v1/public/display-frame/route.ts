/** Quadro público congelado, entregue somente para a sessão atualmente exibida. */
import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { buildPublicLiveView } from '@/lib/server/public-live'
import type { PublicLiveView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const slug = req.nextUrl.searchParams.get('tenant')
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  const version = Number(req.nextUrl.searchParams.get('version'))
  if (!slug || !sessionId || !Number.isSafeInteger(version) || version < 1) throw notFound('Quadro não encontrado.')

  const tenant = await db.tenant.findUnique({ where: { slug } })
  if (!tenant?.active) throw notFound('Quadro não encontrado.')
  const row = await db.displayState.findUnique({ where: { sessionId } })
  if (row?.tenantId !== tenant.id || row.mode !== 'frozen' || row.version !== version || !row.frozenFrameJson || !row.frozenFrameSha256) {
    throw notFound('Quadro não encontrado.')
  }
  const current = await buildPublicLiveView(db, tenant)
  if (current.session?.id !== sessionId || current.displayState?.version !== version) throw notFound('Quadro não encontrado.')
  const sha256 = createHash('sha256').update(row.frozenFrameJson).digest('hex')
  if (sha256 !== row.frozenFrameSha256) throw notFound('Quadro indisponível.')
  const frame = JSON.parse(row.frozenFrameJson) as PublicLiveView
  if (frame.session?.id !== sessionId || frame.displayState !== null) throw notFound('Quadro indisponível.')
  return Response.json({ sessionId, version, sha256, frame }, { headers: { 'Cache-Control': 'no-store' } })
})
