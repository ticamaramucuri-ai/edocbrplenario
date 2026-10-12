/**
 * GET /api/v1/reports/session/:id/ata/signatures — painel de assinaturas
 * eletrônicas da ata (Onda 5 / F22, ADR-023). Leitura do tenant
 * (resolveActor + loadSession com escopo).
 *
 * Responde AtaSignaturesView:
 *  - sessionLabel, published, documentId, docHash (RECOMPUTADO do conteúdo
 *    atual da ata publicada);
 *  - eligible: parlamentares com PRESENÇA na sessão (currentAttendance),
 *    com signed/signedAt/signatureCode;
 *  - signatures: linhas ordenadas por signedAt;
 *  - chainValid: recompute do hash de TODAS as linhas
 *    (computeDocumentSignature) + elos prevHash (primeiro null, cada
 *    seguinte = hash completo da anterior) + docHash de todas as linhas =
 *    sha256 do conteúdo atual — integridade ponta a ponta.
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'
import { currentAttendance } from '@/lib/server/domain'
import { sessionLabel } from '@/lib/server/serializers'
import {
  computeDocHash,
  computeDocumentSignature,
} from '@/lib/server/document-signatures'
import type { AtaSignaturesView, DocumentSignatureView } from '@/lib/contracts'
import type { DocumentSignature } from '@prisma/client'

export const dynamic = 'force-dynamic'

function toView(sig: DocumentSignature): DocumentSignatureView {
  return {
    id: sig.id,
    kind: sig.kind,
    documentId: sig.documentId,
    signatoryParliamentarianId: sig.signatoryParliamentarianId,
    signatoryName: sig.signatoryName,
    docHash: sig.docHash,
    prevHash: sig.prevHash ?? null,
    signatureCode: sig.signatureCode,
    signedAt: sig.signedAt.toISOString(),
  }
}

/**
 * Verificação da cadeia por RECOMPUTAÇÃO: cada hash recalculado precisa
 * (a) igualar o prevHash da linha seguinte, (b) bater com o docHash atual
 * do conteúdo e (c) o primeiro elo apontar para null. O código persistido
 * é conferido contra os 16 primeiros caracteres do hash recomputado.
 */
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
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)

  const [publication, attendance] = await Promise.all([
    db.publication.findFirst({
      where: {
        tenantId: session.tenantId,
        kind: 'ata_sessao',
        status: 'published',
        sessionId: session.id,
        activeAtaSessionKey: session.id,
      },
    }).then((active) => active ?? db.publication.findFirst({ where: { tenantId: session.tenantId,
      kind: 'ata_sessao', status: 'published', sessionId: session.id }, orderBy: { publishedAt: 'desc' } })),
    currentAttendance(db, session.id, session.tenantId),
  ])

  // Assinaturas do documento desta sessão (publication pode não existir).
  const docId = publication?.id ?? null
  const docSignatures = docId
    ? await db.documentSignature.findMany({
        where: { tenantId: session.tenantId, documentId: docId },
        orderBy: { signedAt: 'asc' },
      })
    : []
  const currentDocHash = publication ? computeDocHash(publication.contentMd) : null

  const signedByParl = new Map(
    docSignatures.map((s) => [s.signatoryParliamentarianId, s] as const)
  )

  const view: AtaSignaturesView = {
    sessionId: session.id,
    sessionLabel: sessionLabel(session),
    published: !!publication,
    documentId: docId,
    docHash: currentDocHash,
    eligible: attendance.rows
      .filter((r) => r.present)
      .map((r) => {
        const sig = signedByParl.get(r.parliamentarianId)
        return {
          parliamentarianId: r.parliamentarianId,
          name: r.name,
          signed: !!sig,
          signedAt: sig ? sig.signedAt.toISOString() : null,
          signatureCode: sig ? sig.signatureCode : null,
        }
      }),
    signatures: docSignatures.map(toView),
    chainValid:
      publication && currentDocHash && publication.publishedContentSha256 === currentDocHash
        ? verifySignatureChain(session.tenantId, currentDocHash, docSignatures)
        : !publication,
  }

  return Response.json(view)
})
