/**
 * GET /api/v1/public/documents/ata/:sessionId?tenant=slug — ata pública com
 * assinaturas eletrônicas (Onda 5 / F22, ADR-023). PÚBLICO (resolvePublicTenant,
 * sem ator). 404 quando o tenant não existe/está inativo, a sessão não
 * pertence ao tenant ou não há ata publicada para ela.
 *
 * Responde PublicAtaView: sessionLabel, publishedAt, contentMd, docHash
 * (recomputado do conteúdo atual), signatures (nome, horário, código) e
 * chainValid (recompute de TODOS os hashes + elos prevHash + docHash = sha256
 * do conteúdo atual). A assinatura atesta PRESENÇA — o voto permanece sigiloso.
 */
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'
import { sessionLabel } from '@/lib/server/serializers'
import {
  computeDocHash,
  computeDocumentSignature,
} from '@/lib/server/document-signatures'
import type { PublicAtaView } from '@/lib/contracts'
import type { DocumentSignature } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Mesma verificação por recompute do painel autenticado (ADR-023). */
function verifySignatureChain(
  tenantId: string,
  currentDocHash: string,
  signatures: DocumentSignature[]
): boolean {
  let prev: string | null = null
  for (const sig of signatures) {
    const { code, hash } = computeDocumentSignature(
      tenantId,
      sig.docHash,
      sig.signatoryParliamentarianId,
      sig.signedAt.toISOString()
    )
    if (sig.docHash !== currentDocHash) return false
    if (sig.prevHash !== prev) return false
    if (sig.signatureCode !== code) return false
    prev = hash
  }
  return true
}

export const GET = apiHandler(async (req, ctx, _correlationId) => {
  const { sessionId } = await ctx.params
  const tenant = await resolvePublicTenant(new URL(req.url).searchParams.get('tenant'))

  const session = await db.session.findFirst({
    where: { id: sessionId, tenantId: tenant.id },
  })
  if (!session) throw notFound('Sessão não encontrada para este tenant.')

  const publication = await db.publication.findFirst({
    where: {
      tenantId: tenant.id,
      kind: 'ata_sessao',
      status: 'published',
      sessionId: session.id,
    },
  })
  if (!publication) throw notFound('Ata desta sessão ainda não publicada.')

  const signatures = await db.documentSignature.findMany({
    where: { tenantId: tenant.id, documentId: publication.id },
    orderBy: { signedAt: 'asc' },
  })

  const docHash = computeDocHash(publication.contentMd)

  const view: PublicAtaView = {
    sessionLabel: sessionLabel(session),
    publishedAt: publication.publishedAt ? publication.publishedAt.toISOString() : null,
    contentMd: publication.contentMd,
    docHash,
    signatures: signatures.map((s) => ({
      signatoryName: s.signatoryName,
      signedAt: s.signedAt.toISOString(),
      signatureCode: s.signatureCode,
    })),
    chainValid: verifySignatureChain(tenant.id, docHash, signatures),
  }

  return Response.json(view)
})
