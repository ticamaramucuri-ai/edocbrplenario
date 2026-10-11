/**
 * GET  /api/v1/platform/billing/invoices — lista faturas (desc por issuedAt,
 *       limite 300, include tenant) com filtros opcionais ?tenant=slug (slug
 *       do tenant) &status=open|paid|canceled|overdue (overdue = open com
 *       dueAt vencido) &year=&month= (competência). A resposta inclui
 *       `summary` calculado sobre TODAS as faturas visíveis SEM o filtro de
 *       status (filtros de tenant/competência mantidos): em aberto (não
 *       vencidas), vencidas, pagas no ano corrente (por paidAt) e mrrCents
 *       (Σ preço mensal dos planos com assinatura active/past_due de tenants
 *       ativos no mesmo escopo — trial não conta até a conversão).
 * POST /api/v1/platform/billing/invoices — gera a fatura de {tenantId, year,
 *       month} (mensalidade + excedentes). 409 INVOICE_DUPLICATE_PERIOD quando
 *       já existe fatura da competência; 422 VALIDATION_ERROR nos demais skips
 *       (tenant inativo, sem assinatura, assinatura cancelada, tenant inexistente).
 * RBAC: platform.manage (somente platform_owner).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import {
  generateInvoiceForTenant,
  invoiceView,
  periodLabel,
  INVOICE_SKIP_REASON_LABEL,
} from '@/lib/server/billing'

export const dynamic = 'force-dynamic'

const listQuerySchema = z.object({
  tenant: z.string().min(1, 'Slug do tenant não pode ser vazio.').optional(),
  status: z.enum(['open', 'paid', 'canceled', 'overdue']).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')

  const url = new URL(req.url)
  const q = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
  const now = new Date()

  let tenantId: string | undefined
  if (q.tenant) {
    const tenant = await db.tenant.findUnique({ where: { slug: q.tenant }, select: { id: true } })
    if (!tenant) throw notFound(`Tenant "${q.tenant}" não encontrado.`)
    tenantId = tenant.id
  }

  // Escopo (sem filtro de status) — base do summary.
  const scopeWhere: Prisma.InvoiceWhereInput = {
    ...(tenantId ? { tenantId } : {}),
    ...(q.year !== undefined ? { periodYear: q.year } : {}),
    ...(q.month !== undefined ? { periodMonth: q.month } : {}),
  }
  const statusWhere: Prisma.InvoiceWhereInput = q.status
    ? q.status === 'overdue'
      ? { status: 'open', dueAt: { lt: now } }
      : { status: q.status }
    : {}

  const [invoices, scoped] = await Promise.all([
    db.invoice.findMany({
      where: { ...scopeWhere, ...statusWhere },
      orderBy: { issuedAt: 'desc' },
      take: 300,
      include: { tenant: { select: { name: true, slug: true } } },
    }),
    db.invoice.findMany({
      where: scopeWhere,
      select: { status: true, dueAt: true, paidAt: true, issuedAt: true, totalCents: true },
    }),
  ])

  const yearNow = now.getUTCFullYear()
  const open = scoped.filter((i) => i.status === 'open' && i.dueAt.getTime() >= now.getTime())
  const overdue = scoped.filter((i) => i.status === 'open' && i.dueAt.getTime() < now.getTime())
  const paidThisYear = scoped.filter(
    (i) => i.status === 'paid' && (i.paidAt ?? i.issuedAt).getUTCFullYear() === yearNow
  )

  const subscriptions = await db.subscription.findMany({
    where: {
      status: { in: ['active', 'past_due'] },
      tenant: { active: true, ...(tenantId ? { id: tenantId } : {}) },
    },
    include: { plan: true },
  })
  const mrrCents = subscriptions.reduce((acc, s) => acc + s.plan.priceCents, 0)

  return Response.json({
    invoices: invoices.map((i) => invoiceView(i)),
    summary: {
      openCount: open.length,
      openTotalCents: open.reduce((acc, i) => acc + i.totalCents, 0),
      overdueCount: overdue.length,
      overdueTotalCents: overdue.reduce((acc, i) => acc + i.totalCents, 0),
      paidThisYearCount: paidThisYear.length,
      paidThisYearTotalCents: paidThisYear.reduce((acc, i) => acc + i.totalCents, 0),
      mrrCents,
    },
  })
})

const generateSchema = z.object({
  tenantId: z
    .string()
    .regex(/^c[a-zA-Z0-9]{8,}$/, 'tenantId inválido (esperado um identificador cuid).'),
  year: z.number().int().min(2020, 'Ano fora da faixa (2020–2100).').max(2100),
  month: z.number().int().min(1, 'Mês inválido (1–12).').max(12),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.manage')
  const body = generateSchema.parse(await req.json())

  const result = await withTransaction((tx) =>
    generateInvoiceForTenant(tx, body.tenantId, body.year, body.month, { actor, correlationId })
  )

  if (result.skipped) {
    if (result.reason === 'duplicate_period') {
      throw new DomainError(
        'INVOICE_DUPLICATE_PERIOD',
        409,
        'Fatura duplicada',
        `Já existe fatura para este tenant na competência ${periodLabel(body.year, body.month)}. ` +
          'Cada tenant recebe no máximo uma fatura por competência.'
      )
    }
    const detail = INVOICE_SKIP_REASON_LABEL[result.reason]
    throw new DomainError('VALIDATION_ERROR', 422, 'Fatura não gerada', detail, {
      errors: { _invoice: [detail] },
    })
  }

  const tenant = await db.tenant.findUnique({
    where: { id: body.tenantId },
    select: { name: true },
  })
  return Response.json(
    { invoice: invoiceView(result.invoice, tenant?.name ?? null) },
    { status: 201 }
  )
})
