/**
 * GET /api/v1/matters/:id — detalhe da matéria (Fase 17: enriquecido).
 * RBAC: qualquer ator autenticado com escopo no tenant da matéria
 * (loadMatter → assertTenantScope; platform_* tem escopo global).
 * Payload: matter + proceedings (seq asc) + versions + attachments +
 * related (AMBAS as direções, perspectiva desta matéria) + outcomes (data asc).
 */
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadMatter } from '@/lib/server/loaders'
import {
  toMatterView,
  toProceedingView,
  toMatterVersionView,
  toMatterAttachmentView,
  matterAttachmentMetadata,
  toRelatedMatterView,
  toMatterOutcomeView,
} from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)

  const [proceedings, versions, attachments, related, outcomes] = await Promise.all([
    db.proceeding.findMany({ where: { matterId: matter.id }, orderBy: { seq: 'asc' } }),
    db.matterVersion.findMany({
      where: { matterId: matter.id },
      orderBy: { version: 'asc' },
    }),
    db.matterAttachment.findMany({ where: { matterId: matter.id }, orderBy: { createdAt: 'asc' }, select: matterAttachmentMetadata }),
    db.relatedMatter.findMany({
      where: { OR: [{ matterId: matter.id }, { relatedMatterId: matter.id }] },
      include: { matter: true, relatedMatter: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.matterOutcome.findMany({
      where: { matterId: matter.id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ])

  return Response.json({
    matter: toMatterView(matter),
    proceedings: proceedings.map(toProceedingView),
    versions: versions.map(toMatterVersionView),
    attachments: attachments.map(toMatterAttachmentView),
    related: related.map((r) => toRelatedMatterView(r, matter.id)),
    outcomes: outcomes.map(toMatterOutcomeView),
  })
})
