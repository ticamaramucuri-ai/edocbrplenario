/**
 * GET|POST /api/v1/publications — diário eletrônico do tenant (Fase 11).
 * GET: filtros status/kind/year/q; lista desc por (year, number).
 * POST: RBAC publication.write; cria DRAFT com número sequencial por
 * (tenant, ano corrente) — max+1 dentro da transação — e código de
 * verificação de 8 caracteres [A-Z0-9]. Auditoria `publication.created`.
 * Fase 14: `templateId` opcional registra a origem na MESMA transação com
 * auditoria extra `template.rendered` (modelo precisa ser do tenant e ATIVO).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { DocumentTemplate, LegislativeMatter, Session } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import {
  PUBLICATION_KINDS,
  PUBLICATION_KIND_LABEL,
  generateVerificationCode,
  publicationNumberLabel,
  toPublicationView,
  type PublicationKind,
} from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  // resolveTenantScope lê `?tenant=` via nextUrl — cast do Request do wrapper.
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const params = new URL(req.url).searchParams

  const status = params.get('status')?.trim() || null
  const kind = params.get('kind')?.trim() || null
  const q = params.get('q')?.trim() || null
  const yearRaw = params.get('year')?.trim()
  let year: number | undefined
  if (yearRaw) {
    year = Number(yearRaw)
    if (!Number.isInteger(year) || String(year).length !== 4) year = undefined
  }

  const publications = await db.publication.findMany({
    where: {
      tenantId,
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...(year ? { year } : {}),
      ...(q ? { title: { contains: q } } : {}),
    },
    orderBy: [{ year: 'desc' }, { number: 'desc' }],
    take: 300,
  })

  return Response.json({ publications: publications.map(toPublicationView) })
})

const createSchema = z.object({
  kind: z.enum(PUBLICATION_KINDS),
  title: z
    .string()
    .trim()
    .min(5, 'Título deve ter entre 5 e 200 caracteres.')
    .max(200, 'Título deve ter entre 5 e 200 caracteres.'),
  contentMd: z.string().max(60000).optional(),
  sessionId: z.string().trim().min(1).optional(),
  matterId: z.string().trim().min(1).optional(),
  templateId: z.string().trim().min(1).optional(),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'publication.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const body = createSchema.parse(await req.json())
  if (body.kind === 'ata_sessao' && !body.sessionId) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Sessão obrigatória', 'Ata de sessão deve estar vinculada a uma sessão desta Câmara.')
  }
  const year = new Date().getFullYear()

  // Vínculos opcionais precisam existir e pertencer ao escopo do ator.
  let session: Session | null = null
  if (body.sessionId) {
    session = await db.session.findUnique({ where: { id: body.sessionId } })
    if (!session) throw notFound('Sessão vinculada não encontrada.')
    assertTenantScope(actor, session.tenantId)
    if (session.tenantId !== tenantId) throw notFound('Sessão vinculada não encontrada nesta Câmara.')
  }
  let matter: LegislativeMatter | null = null
  if (body.matterId) {
    matter = await db.legislativeMatter.findUnique({ where: { id: body.matterId } })
    if (!matter) throw notFound('Matéria vinculada não encontrada.')
    assertTenantScope(actor, matter.tenantId)
    if (matter.tenantId !== tenantId) throw notFound('Matéria vinculada não encontrada nesta Câmara.')
  }

  // Fase 14: origem opcional em modelo de documento — precisa existir, ser do
  // escopo resolvido e estar ATIVO (inativo → 422; outro tenant → 404).
  let template: DocumentTemplate | null = null
  if (body.templateId) {
    template = await db.documentTemplate.findUnique({ where: { id: body.templateId } })
    if (!template || template.tenantId !== tenantId) {
      throw notFound('Modelo não encontrado neste tenant.')
    }
    if (!template.active) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Modelo de documento inativo para esta operação.',
        { errors: { templateId: ['Modelo inativo — reative-o antes de criar publicações a partir dele.'] } }
      )
    }
  }

  const publication = await withTransaction(async (tx) => {
    const last = await tx.publication.findFirst({
      where: { tenantId, year },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    const number = (last?.number ?? 0) + 1
    const created = await tx.publication.create({
      data: {
        tenantId,
        number,
        year,
        kind: body.kind,
        title: body.title.trim(),
        contentMd: body.contentMd ?? '',
        sessionId: session?.id ?? null,
        matterId: matter?.id ?? null,
        status: 'draft',
        verificationCode: generateVerificationCode(),
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'publication.created',
      aggregateType: 'publication',
      aggregateId: created.id,
      summary: `Publicação nº ${publicationNumberLabel(number, year)} criada em rascunho (${
        PUBLICATION_KIND_LABEL[body.kind as PublicationKind]
      }): ${created.title.slice(0, 60)}.`,
      after: {
        number,
        year,
        kind: created.kind,
        title: created.title,
        status: 'draft',
        sessionId: created.sessionId,
        matterId: created.matterId,
      },
      correlationId,
      ip: clientIp(req),
    })
    // Fase 14: origem em modelo — evento extra NA MESMA transação.
    if (template) {
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'template.rendered',
        aggregateType: 'document_template',
        aggregateId: template.id,
        summary: `Publicação nº ${publicationNumberLabel(number, year)} criada a partir do modelo "${template.name}" (v${template.currentVersion}).`,
        after: {
          publicationId: created.id,
          templateId: template.id,
          templateVersion: template.currentVersion,
        },
        correlationId,
        ip: clientIp(req),
      })
    }
    return created
  })

  return Response.json({ publication: toPublicationView(publication) }, { status: 201 })
})
