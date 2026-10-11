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
  publicationNumberLabel,
  toPublicationDetailView,
  toPublicationView,
} from '@/lib/server/publications'

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
  z.object({
    action: z.literal('revoke'),
    reason: z
      .string()
      .trim()
      .min(10, 'Motivo da revogação é obrigatório (mín. 10 caracteres).')
      .max(2000),
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

  const publication = await withTransaction(async (tx) => {
    if (body.action === 'publish') {
      assertPublicationTransition(current.status, 'published')
      const publishedAt = new Date()
      const updated = await tx.publication.update({
        where: { id: current.id },
        data: { status: 'published', publishedAt },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'publication.published',
        aggregateType: 'publication',
        aggregateId: current.id,
        summary: `Publicação nº ${publicationNumberLabel(current.number, current.year)} publicada no diário eletrônico: ${current.title.slice(0, 60)}.`,
        before: { status: current.status },
        after: { status: 'published', publishedAt: publishedAt.toISOString() },
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
      assertPublicationTransition(current.status, 'revoked')
      const revokedAt = new Date()
      const updated = await tx.publication.update({
        where: { id: current.id },
        data: { status: 'revoked', revokedAt, revokedReason: body.reason },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'publication.revoked',
        aggregateType: 'publication',
        aggregateId: current.id,
        summary: `Publicação nº ${publicationNumberLabel(current.number, current.year)} REVOGADA: ${current.title.slice(0, 60)}.`,
        before: { status: current.status },
        after: { status: 'revoked', revokedAt: revokedAt.toISOString(), revokedReason: body.reason },
        justification: body.reason,
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
          reason: body.reason,
        },
        publicPayload: {
          publicationId: current.id,
          numberLabel: publicationNumberLabel(current.number, current.year),
          title: current.title,
          reason: body.reason,
        },
      })
      return updated
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
    const updated = await tx.publication.update({
      where: { id: current.id },
      data: { title, contentMd },
    })
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

  return Response.json({ publication: toPublicationView(publication) })
})
