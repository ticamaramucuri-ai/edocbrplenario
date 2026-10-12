/**
 * POST /api/v1/me/ata/sign — assinatura eletrônica da ata (Onda 5 / F22).
 *
 * Parlamentar (requirePermission 'self.vote' + vínculo via
 * requireMeParliamentarian). Encontra a última sessão ENCERRADA do tenant
 * com ata publicada (Publication kind=ata_sessao, status=published), valida
 * PRESENÇA registrada do parlamentar (currentAttendance — último evento por
 * parlamentar) e cria a assinatura na cadeia de hash (ADR-023):
 *
 *   docHash  = sha256(contentMd publicado)
 *   prevHash = hash completo da última assinatura do documento
 *   code     = HMAC(tenantKey, docHash|parl|signedAt)[:16]
 *
 * Idempotente por (documentId, signatoryParliamentarianId): já assinado →
 * 200 com a assinatura existente (SEM nova linha). Sem ata publicada ou
 * parlamentar ausente → 422 VALIDATION_ERROR. Auditoria `ata.signed`.
 * A assinatura atesta PRESENÇA — o voto secreto permanece sigiloso.
 */
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireMeParliamentarian } from '@/lib/server/me'
import { currentAttendance } from '@/lib/server/domain'
import { writeAudit } from '@/lib/server/audit'
import { computeDocHash, computeDocumentSignature } from '@/lib/server/document-signatures'
import type { DocumentSignatureView, Role } from '@/lib/contracts'
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

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'self.vote')
  const parliamentarian = await requireMeParliamentarian(actor)

  // Última sessão encerrada do tenant com ata PUBLICADA vinculada
  // (Publication não tem relation declarada para Session — casamento por ids).
  const publishedAtas = await db.publication.findMany({
    where: {
      tenantId: parliamentarian.tenantId,
      kind: 'ata_sessao',
      status: 'published',
      sessionId: { not: null },
      activeAtaSessionKey: { not: null },
    },
    select: { id: true, contentMd: true, sessionId: true, publishedContentSha256: true },
  })
  const closedSessions = await db.session.findMany({
    where: {
      tenantId: parliamentarian.tenantId,
      status: 'closed',
      id: { in: publishedAtas.map((p) => p.sessionId as string) },
    },
    orderBy: { closedAt: 'desc' },
  })
  const session = closedSessions[0] ?? null
  const publication = session
    ? (publishedAtas.find((p) => p.sessionId === session.id) ?? null)
    : null
  if (!session || !publication) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Sem ata para assinar',
      'Não há ata de sessão encerrada publicada no diário eletrônico deste tenant. A assinatura eletrônica fica disponível após a publicação da ata.'
    )
  }
  if (publication.publishedContentSha256 !== computeDocHash(publication.contentMd)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Ata sem integridade', 'O conteúdo publicado não confere com o hash registrado. A assinatura foi bloqueada.')
  }

  // Presença registrada = último AttendanceEvent do parlamentar na sessão.
  const attendance = await currentAttendance(db, session.id, session.tenantId)
  const row = attendance.rows.find((r) => r.parliamentarianId === parliamentarian.id)
  if (!row || !row.present) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Presença não registrada',
      `Sua presença nesta sessão não está registrada (situação atual: ${row?.status ?? 'ausente'}) — apenas parlamentares presentes podem assinar a ata eletronicamente.`
    )
  }

  // Tudo em UMA transação serializada (mutex de escrita): idempotência +
  // elo prevHash coerente mesmo com assinaturas concorrentes.
  const created = await withTransaction(async (tx) => {
    const existing = await tx.documentSignature.findUnique({
      where: {
        tenantId_kind_documentId_signatoryParliamentarianId: {
          tenantId: session.tenantId,
          kind: 'ata_sessao',
          documentId: publication.id,
          signatoryParliamentarianId: parliamentarian.id,
        },
      },
    })
    if (existing) return { signature: existing, created: false }

    const docHash = computeDocHash(publication.contentMd)
    const last = await tx.documentSignature.findFirst({
      where: { tenantId: session.tenantId, documentId: publication.id },
      orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    })
    // Elo da cadeia: hash COMPLETO da última assinatura (primeira → null).
    const prevHash = last
      ? computeDocumentSignature(
          session.tenantId,
          last.docHash,
          last.signatoryParliamentarianId,
          last.signedAt.toISOString()
        ).hash
      : null

    const signedAt = new Date()
    const { code } = computeDocumentSignature(
      session.tenantId,
      docHash,
      parliamentarian.id,
      signedAt.toISOString()
    )

    const signature = await tx.documentSignature.create({
      data: {
        tenantId: session.tenantId,
        kind: 'ata_sessao',
        documentId: publication.id,
        signatoryParliamentarianId: parliamentarian.id,
        signatoryName: parliamentarian.name,
        docHash,
        prevHash,
        signatureCode: code,
        signedAt,
      },
    })

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor: { name: actor.name, role: actor.role as Role },
      action: 'ata.signed',
      aggregateType: 'document_signature',
      aggregateId: publication.id,
      summary: `${parliamentarian.name} assinou eletronicamente a ata da sessão (código ${code}) — cadeia de hash verificável (ADR-023).`,
      correlationId,
    })

    return { signature, created: true }
  })

  return Response.json({ signature: toView(created.signature) })
})
