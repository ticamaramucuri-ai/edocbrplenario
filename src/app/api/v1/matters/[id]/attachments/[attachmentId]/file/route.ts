/** Private matter PDF; never served from the public assets directory. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadMatter } from '@/lib/server/loaders'
import { verifyPrivateMatterAttachment } from '@/lib/server/matter-attachment-private'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  const { id, attachmentId } = await ctx.params
  const matter = await loadMatter(actor, id)
  const attachment = await db.matterAttachment.findFirst({ where: { id: attachmentId, matterId: matter.id },
    select: { content: true, sizeBytes: true, sha256: true, mimeType: true } })
  if (!attachment || !attachment.sha256) throw notFound('Arquivo privado não encontrado nesta matéria.')
  let bytes: Uint8Array
  try { bytes = verifyPrivateMatterAttachment(attachment) } catch {
    throw new DomainError('DOCUMENT_INTEGRITY_FAILED', 409, 'Anexo alterado',
      'O arquivo não corresponde ao hash e tamanho registrados. Suspenda o download e confira a restauração.')
  }
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="anexo-materia.pdf"',
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
})
