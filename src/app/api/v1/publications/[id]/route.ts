/**
 * GET|PATCH /api/v1/publications/:id — diário eletrônico (Fase 11).
 *
 * GET: detalhe interno COM contentMd (dialogs Ver/Editar do módulo).
 * PATCH (RBAC publication.write) discrimina por `action`:
 * - 'publish': apenas draft→published (publishedAt=now); auditoria
 *   `publication.published` + outbox público `publication.published`;
 * - 'revoke': apenas published→revoked com motivo (min 10); auditoria
 *   `publication.revoked` (justification=motivo) + outbox `publication.revoked`;
 * - 'edit': apenas draft; título/conteúdo (auditoria `publication.updated`).
 * Transição inválida → 409 PUBLICATION_INVALID_TRANSITION. Publicação de
 * outro tenant (fora do escopo resolvido) → 404 (não vaza existência).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import {
  assertPublicationTransition,
  generateVerificationCode,
  publicationReviewHash,
  publicationNumberLabel,
  toPublicationDetailView,
  toPublicationView,
} from '@/lib/server/publications'
import { computeDocHash } from '@/lib/server/document-signatures'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params

  const publication = await db.publication.findUnique({ where: { id } })
  if (!publication || publication.tenantId !== tenantId) {
    throw notFound('Publicação não encontrada neste tenant.')
  }
  return Response.json({ publication: toPublicationDetailView(publication) })
})

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('review'), expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    reference: z.string().trim().min(5).max(200) }),
  z.object({
    action: z.literal('revoke'),
    reason: z
      .string()
      .trim()
      .min(10, 'Motivo da revogação é obrigatório (mín. 10 caracteres).')
      .max(2000),
  }),
  z.object({
    action: z.literal('rectify'),
    reason: z
      .string()
      .trim()
      .min(10, 'Motivo da retificação é obrigatório (mín. 10 caracteres).')
      .max(2000),
    title: z
      .string()
      .trim()
      .min(5, 'Título deve ter entre 5 e 200 caracteres.')
      .max(200)
      .optional(),
    contentMd: z.string().max(60000).optional(),
  }),
  z.object({
    action: z.literal('edit'),
    title: z
      .string()
      .trim()
      .min(5, 'Título deve ter entre 5 e 200 caracteres.')
      .max(200)
      .optional(),
    contentMd: z.string().max(60000).optional(),
  }),
])

/** Versão do agregado = nº de eventos outbox prévios + 1 (publish=1, revoke=2). */
async function nextAggregateVersion(
  tx: Prisma.TransactionClient,
  tenantId: string,
  aggregateId: string
): Promise<number> {
  return (await tx.outboxEvent.count({ where: { tenantId, aggregateId } })) + 1
}

export const PATCH = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'publication.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())
  const ip = clientIp(req)

  const current = await db.publication.findUnique({ where: { id } })
  if (!current || current.tenantId !== tenantId) {
    throw notFound('Publicação não encontrada neste tenant.')
  }

  let rectifiedPublication: Awaited<ReturnType<typeof db.publication.create>> | null = null

  const publication = await withTransaction(async (tx) => {
    const current = await tx.publication.findUniqueOrThrow({ where: { id, tenantId } })

    const revokeInTx = async (reason: string) => {
      assertPublicationTransition(current.status, 'revoked')
      const revokedAt = new Date()
      const changed = await tx.publication.updateMany({
        where: { id: current.id, tenantId, status: 'published' },
        data: { status: 'revoked', revokedAt, revokedReason: reason, activeAtaSessionKey: null },
      })
      if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Publicação alterada', 'Recarregue a publicação.')
      const updated = await tx.publication.findUniqueOrThrow({ where: { id: current.id } })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'publication.revoked',
        aggregateType: 'publication',
        aggregateId: current.id,
        summary: `Publicação nº ${publicationNumberLabel(current.number, current.year)} REVOGADA: ${current.title.slice(0, 60)}.`,
        before: { status: current.status },
        after: { status: 'revoked', revokedAt: revokedAt.toISOString(), revokedReason: reason },
        justification: reason,
        correlationId,
        ip,
      })
      await emitOutbox(tx, {
        tenantId,
        eventType: 'publication.revoked',
        aggregateId: current.id,
        aggregateVersion: await nextAggregateVersion(tx, tenantId, current.id),
        correlationId,
        origin: 'operator',
        internalPayload: {
          publicationId: current.id,
          number: current.number,
          year: current.year,
          title: current.title,
          status: 'revoked',
          reason,
        },
        publicPayload: {
          publicationId: current.id,
          numberLabel: publicationNumberLabel(current.number, current.year),
          title: current.title,
          reason,
        },
      })
      return updated
    }
    if (body.action === 'review') {
      if (current.kind !== 'ata_sessao' || current.status !== 'draft' || !current.sessionId) {
        throw new DomainError('PUBLICATION_INVALID_TRANSITION', 409, 'Revisão indisponível', 'Somente rascunho de ata vinculado à sessão pode ser revisado.')
      }
      const session = await tx.session.findFirst({ where: { id: current.sessionId, tenantId } })
      if (!session || session.status !== 'closed') {
        throw new DomainError('SESSION_PRECONDITION', 409, 'Sessão não encerrada', 'Encerre a sessão antes de revisar sua ata.')
      }
      if (current.contentMd.trim().length < 20) {
        throw new DomainError('VALIDATION_ERROR', 422, 'Ata incompleta', 'A ata precisa de conteúdo antes da revisão.')
      }
      const hash = publicationReviewHash(current)
      if (hash !== body.expectedHash) {
        throw new DomainError('CONFLICT_VERSION', 409, 'Texto alterado', 'O texto da ata mudou. Abra novamente e confira o conteúdo antes de revisar.')
      }
      if (current.reviewHash) {
        if (current.reviewHash === hash && current.reviewedById === actor.id && current.reviewReference === body.reference) return current
        throw new DomainError('PUBLICATION_INVALID_TRANSITION', 409, 'Ata já revisada', 'Edite o rascunho para iniciar uma nova revisão.')
      }
      const reviewedAt = new Date()
      const changed = await tx.publication.updateMany({ where: { id, tenantId, status: 'draft', reviewHash: null,
        title: current.title, contentMd: current.contentMd, sessionId: current.sessionId },
        data: { reviewHash: hash, reviewedById: actor.id, reviewedByName: actor.name, reviewedAt, reviewReference: body.reference } })
      if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Rascunho alterado', 'Recarregue a ata.')
      await writeAudit(tx, { tenantId, actor, action: 'ata.reviewed', aggregateType: 'publication', aggregateId: id,
        summary: `Ata nº ${publicationNumberLabel(current.number, current.year)} revisada por ${actor.name}.`,
        after: { reviewHash: hash, sessionId: current.sessionId, reference: body.reference },
        correlationId, ip })
      return tx.publication.findUniqueOrThrow({ where: { id } })
    }
    if (body.action === 'publish') {
      assertPublicationTransition(current.status, 'published')
      if (current.kind === 'ata_sessao') {
        if (!current.sessionId || !current.reviewHash || !current.reviewedById ||
            current.reviewHash !== publicationReviewHash(current)) {
          throw new DomainError('PUBLICATION_INVALID_TRANSITION', 409, 'Ata sem revisão vigente',
            'Revise o texto atual da ata antes de publicá-la.')
        }
        if (current.reviewedById === actor.id) {
          throw new DomainError('FORBIDDEN_ROLE', 403, 'Publicação independente', 'Outra pessoa deve autorizar a publicação da ata revisada.')
        }
        const session = await tx.session.findFirst({ where: { id: current.sessionId, tenantId } })
        if (!session || session.status !== 'closed') {
          throw new DomainError('SESSION_PRECONDITION', 409, 'Sessão não encerrada', 'A ata só pode ser publicada após o encerramento da sessão.')
        }
        const activeAta = await tx.publication.findFirst({ where: {
          tenantId, kind: 'ata_sessao', status: 'published', sessionId: current.sessionId,
        }, select: { id: true } })
        if (activeAta && activeAta.id !== current.id) {
          throw new DomainError('PUBLICATION_INVALID_TRANSITION', 409, 'Ata já publicada', 'Revogue a ata vigente antes de publicar um novo ato de correção.')
        }
      }
      const publishedAt = new Date()
      const publishedContentSha256 = computeDocHash(current.contentMd)
      const changed = await tx.publication.updateMany({ where: { id: current.id, tenantId, status: 'draft',
        title: current.title, contentMd: current.contentMd, reviewHash: current.reviewHash },
        data: { status: 'published', publishedAt, publishedContentSha256,
          activeAtaSessionKey: current.kind === 'ata_sessao' ? current.sessionId : null } })
      if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Rascunho alterado', 'Recarregue a publicação.')
      const updated = await tx.publication.findUniqueOrThrow({ where: { id: current.id } })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'publication.published',
        aggregateType: 'publication',
        aggregateId: current.id,
        summary: `Publicação nº ${publicationNumberLabel(current.number, current.year)} publicada no diário eletrônico: ${current.title.slice(0, 60)}.`,
        before: { status: current.status },
        after: { status: 'published', publishedAt: publishedAt.toISOString(), publishedContentSha256,
          reviewHash: current.reviewHash, reviewedById: current.reviewedById, sessionId: current.sessionId },
        correlationId,
        ip,
      })
      await emitOutbox(tx, {
        tenantId,
        eventType: 'publication.published',
        aggregateId: current.id,
        aggregateVersion: await nextAggregateVersion(tx, tenantId, current.id),
        correlationId,
        origin: 'operator',
        internalPayload: {
          publicationId: current.id,
          number: current.number,
          year: current.year,
          kind: current.kind,
          title: current.title,
          status: 'published',
        },
        publicPayload: {
          publicationId: current.id,
          numberLabel: publicationNumberLabel(current.number, current.year),
          kind: current.kind,
          title: current.title,
          verificationCode: current.verificationCode,
          publishedAt: publishedAt.toISOString(),
        },
      })
      return updated
    }

    if (body.action === 'revoke') {
      return revokeInTx(body.reason)
    }

    if (body.action === 'rectify') {
      if (current.status === 'draft') {
        throw new DomainError(
          'PUBLICATION_INVALID_TRANSITION',
          409,
          'Transição inválida',
          'Rascunhos devem ser editados diretamente; somente atos publicados ou revogados podem ser retificados.'
        )
      }
      const sourceUpdated = current.status === 'published' ? await revokeInTx(body.reason) : current
      const year = new Date().getFullYear()
      const last = await tx.publication.findFirst({
        where: { tenantId, year },
        orderBy: { number: 'desc' },
        select: { number: true },
      })
      const number = (last?.number ?? 0) + 1
      const title = body.title ?? `Retificação (${publicationNumberLabel(current.number, current.year)}) — ${current.title}`.slice(0, 200)
      const contentMd = body.contentMd ?? current.contentMd
      const created = await tx.publication.create({
        data: {
          tenantId,
          number,
          year,
          kind: current.kind,
          title,
          contentMd,
          sessionId: current.sessionId,
          matterId: current.matterId,
          status: 'draft',
          verificationCode: generateVerificationCode(),
          rectifiesPublicationId: current.id,
        },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'publication.rectified',
        aggregateType: 'publication',
        aggregateId: created.id,
        summary: `Publicação nº ${publicationNumberLabel(number, year)} criada como retificação do ato nº ${publicationNumberLabel(current.number, current.year)}.`,
        after: {
          number,
          year,
          kind: created.kind,
          title: created.title,
          rectifiesPublicationId: current.id,
          sessionId: created.sessionId,
        },
        justification: body.reason,
        correlationId,
        ip,
      })
      rectifiedPublication = created
      return sourceUpdated
    }

    // action === 'edit' — apenas rascunho é editável.
    if (current.status !== 'draft') {
      throw new DomainError(
        'PUBLICATION_INVALID_TRANSITION',
        409,
        'Transição inválida',
        'Apenas rascunhos podem ser editados. Publicações já publicadas são imutáveis (podem apenas ser revogadas).'
      )
    }
    const title = body.title ?? current.title
    const contentMd = body.contentMd ?? current.contentMd
    const changed = await tx.publication.updateMany({
      where: { id: current.id, tenantId, status: 'draft', title: current.title, contentMd: current.contentMd,
        reviewHash: current.reviewHash },
      data: { title, contentMd, reviewHash: null, reviewedById: null, reviewedByName: null,
        reviewedAt: null, reviewReference: null },
    })
    if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Rascunho alterado', 'Recarregue a publicação.')
    const updated = await tx.publication.findUniqueOrThrow({ where: { id: current.id } })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'publication.updated',
      aggregateType: 'publication',
      aggregateId: current.id,
      summary: `Rascunho nº ${publicationNumberLabel(current.number, current.year)} editado: ${title.slice(0, 60)}.`,
      before: { title: current.title, contentLength: current.contentMd.length },
      after: { title, contentLength: contentMd.length },
      correlationId,
      ip,
    })
    return updated
  })

  return Response.json({
    publication: toPublicationView(publication),
    ...(rectifiedPublication ? { rectifiedPublication: toPublicationView(rectifiedPublication) } : {}),
  })
})
