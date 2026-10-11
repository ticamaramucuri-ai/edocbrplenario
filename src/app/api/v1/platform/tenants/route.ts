/**
 * GET  /api/v1/platform/tenants — todos os tenants com assinatura, uso e
 *       health score (0-100: 50 base + até 30 por atividade recente
 *       [sessões nos últimos 30d normalizado por 10] + 20 sem webhooks mortos).
 * POST /api/v1/platform/tenants — onboarding de nova Câmara: tenant (cores
 *       default) + legislatura atual + tenant_admin demo + assinatura trial
 *       14 dias. Auditoria platform.tenant_created (cadeia do NOVO tenant).
 * RBAC: platform.manage (somente platform_owner).
 *
 * LIMITAÇÃO DOCUMENTADA (Fase 8): desativar um tenant NÃO bloqueia as rotas
 * do tenant — o flag apenas reflete no console (contrato de operação do
 * piloto; bloqueio total exigiria gate central por requisição).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

/** Health score do tenant (documentado no console: saudável≥70, atenção 40-69, crítico<40). */
export async function tenantHealthScore(tenantId: string): Promise<{ score: number; sessionsLast30d: number; deadWebhooks: number }> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const now = new Date()
  const [sessionsLast30d, deadWebhooks] = await Promise.all([
    db.session.count({ where: { tenantId, scheduledAt: { gte: since30d, lte: now } } }),
    db.webhookDelivery.count({ where: { status: 'dead', endpoint: { tenantId } } }),
  ])
  const activity = Math.min(sessionsLast30d / 10, 1) * 30
  const score = Math.round(50 + activity + (deadWebhooks === 0 ? 20 : 0))
  return { score: Math.min(100, Math.max(0, score)), sessionsLast30d, deadWebhooks }
}

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')

  const tenants = await db.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: { subscription: { include: { plan: true } } },
  })

  const enriched = await Promise.all(
    tenants.map(async (tenant) => {
      const [parliamentarians, sessions, matters, votes, health] = await Promise.all([
        db.parliamentarian.count({ where: { tenantId: tenant.id, active: true } }),
        db.session.count({ where: { tenantId: tenant.id } }),
        db.legislativeMatter.count({ where: { tenantId: tenant.id } }),
        db.vote.count({ where: { voting: { session: { tenantId: tenant.id } } } }),
        tenantHealthScore(tenant.id),
      ])
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        city: tenant.city,
        uf: tenant.uf,
        active: tenant.active,
        createdAt: tenant.createdAt.toISOString(),
        subscription: tenant.subscription
          ? {
              status: tenant.subscription.status,
              trialEndsAt: tenant.subscription.trialEndsAt?.toISOString() ?? null,
              currentPeriodEnd: tenant.subscription.currentPeriodEnd?.toISOString() ?? null,
              plan: {
                id: tenant.subscription.plan.id,
                name: tenant.subscription.plan.name,
                priceCents: tenant.subscription.plan.priceCents,
                features: safeFeatures(tenant.subscription.plan.limits),
              },
            }
          : null,
        usage: { parliamentarians, sessions, matters, votes },
        healthScore: health.score,
        healthDetail: health,
      }
    })
  )

  return Response.json({ tenants: enriched })
})

function safeFeatures(limitsJson: string): string[] {
  try {
    const parsed = JSON.parse(limitsJson) as { features?: unknown }
    return Array.isArray(parsed.features) ? parsed.features.map(String) : []
  } catch {
    return []
  }
}

const createSchema = z.object({
  name: z.string().min(4, 'Nome da Câmara deve ter ao menos 4 caracteres.').max(160),
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens.'),
  city: z.string().min(2).max(120),
  uf: z.enum(UFS as [string, ...string[]]),
  planId: z.string().min(1, 'Selecione o plano inicial.'),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')
  const body = createSchema.parse(await req.json())

  const plan = await db.plan.findUnique({ where: { id: body.planId } })
  if (!plan || !plan.active) throw notFound(`Plano "${body.planId}" não encontrado ou inativo.`)

  const [slugTaken, emailTaken] = await Promise.all([
    db.tenant.findUnique({ where: { slug: body.slug } }),
    db.user.findUnique({ where: { email: `admin@${body.slug}.leg.br` } }),
  ])
  if (slugTaken) {
    return Response.json(
      {
        type: 'https://legis-saas/errors/validation-error',
        title: 'Dados inválidos',
        status: 422,
        detail: `Slug "${body.slug}" já está em uso por outro tenant.`,
        code: 'VALIDATION_ERROR',
        correlationId,
        errors: { slug: ['Slug já utilizado.'] },
      },
      { status: 422 }
    )
  }
  if (emailTaken) {
    return Response.json(
      {
        type: 'https://legis-saas/errors/validation-error',
        title: 'Dados inválidos',
        status: 422,
        detail: `O e-mail admin@${body.slug}.leg.br já existe na plataforma.`,
        code: 'VALIDATION_ERROR',
        correlationId,
        errors: { slug: ['E-mail do administrador demo já utilizado.'] },
      },
      { status: 422 }
    )
  }

  const year = new Date().getFullYear()
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  const created = await withTransaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: body.slug,
        name: body.name,
        city: body.city,
        uf: body.uf,
        plan: plan.name,
        settings: JSON.stringify({
          quorumMinimum: Math.max(3, Math.ceil(9 / 2)),
          allowVoteChange: true,
          speechDefaultSeconds: 300,
          soundAlerts: true,
          hidePartialByDefault: false,
        }),
      },
    })
    const legislature = await tx.legislature.create({
      data: { tenantId: tenant.id, number: 1, startYear: year, endYear: year + 3, current: true },
    })
    await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: `Administrador ${body.city}`,
        email: `admin@${body.slug}.leg.br`,
        role: 'tenant_admin',
        jobTitle: 'Administrador da Câmara',
      },
    })
    const subscription = await tx.subscription.create({
      data: { tenantId: tenant.id, planId: plan.id, status: 'trial', trialEndsAt },
    })
    await writeAudit(tx, {
      tenantId: tenant.id,
      actor,
      action: 'platform.tenant_created',
      aggregateType: 'platform',
      aggregateId: tenant.id,
      summary: `Câmara "${body.name}" (${body.city}/${body.uf}) provisionada no plano ${plan.name} (trial até ${trialEndsAt.toLocaleDateString('pt-BR')}). Legislatura ${legislature.number}ª (${year}-${year + 3}) e administrador demo criados.`,
      after: { slug: body.slug, plan: plan.name, trialEndsAt: trialEndsAt.toISOString() },
      correlationId,
    })
    return { tenant, legislature, subscription }
  })

  return Response.json(
    {
      tenant: {
        id: created.tenant.id,
        name: created.tenant.name,
        slug: created.tenant.slug,
        city: created.tenant.city,
        uf: created.tenant.uf,
        active: true,
        createdAt: created.tenant.createdAt.toISOString(),
        subscription: {
          status: 'trial',
          trialEndsAt: trialEndsAt.toISOString(),
          currentPeriodEnd: null,
          plan: { id: plan.id, name: plan.name, priceCents: plan.priceCents, features: safeFeatures(plan.limits) },
        },
        usage: { parliamentarians: 0, sessions: 0, matters: 0, votes: 0 },
        healthScore: 70,
      },
    },
    { status: 201 }
  )
})
