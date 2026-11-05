import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  const { id, documentId } = await ctx.params
  const session = await loadSession(actor, id)
  const document = await db.sessionDocument.findFirst({ where: { id: documentId, sessionId: id, tenantId: session.tenantId } })
  if (!document) throw notFound('Documento não encontrado nesta sessão.')
  if (document.content.length !== document.sizeBytes ||
      createHash('sha256').update(document.content).digest('hex') !== document.sha256) {
    throw new DomainError('DOCUMENT_INTEGRITY_FAILED', 409, 'Documento alterado',
      'O conteúdo não corresponde ao hash e tamanho registrados. Suspenda o download e confira a restauração.')
  }
  return new Response(new Uint8Array(document.content), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="documento-sessao.pdf"',
    'Content-Length': String(document.sizeBytes),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
})
