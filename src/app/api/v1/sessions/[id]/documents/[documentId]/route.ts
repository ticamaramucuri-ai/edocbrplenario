import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  const { id, documentId } = await ctx.params
  const session = await loadSession(actor, id)
  const document = await db.sessionDocument.findFirst({ where: { id: documentId, sessionId: id, tenantId: session.tenantId } })
  if (!document) throw notFound('Documento não encontrado nesta sessão.')
  return new Response(new Uint8Array(document.content), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="documento-sessao.pdf"',
    'Content-Length': String(document.sizeBytes),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
})
