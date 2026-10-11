/**
 * Faturamento do SaaS (Fase 10) — regras de negócio do ciclo comercial.
 *
 * Modelo: Invoice (mensalidade do plano + excedentes de uso), uma por
 * tenant/competência (@@unique). Status persistido: open|paid|canceled —
 * "vencida" NÃO é status: é computada na leitura (open && dueAt < agora).
 *
 * Ciclo mensal (runBillingCycle):
 *  1. gera a fatura do mês corrente para todo tenant ativo com assinatura
 *     trial/active/past_due (skip silencioso quando já existe);
 *  2. dunning: faturas abertas vencidas mantêm o status `open`, mas a
 *     assinatura do tenant entra em past_due (idempotente — só age quando
 *     trial/active) + notificação ao tenant_admin + evento de outbox.
 *
 * Todas as mutações gravam auditoria (cadeia do tenant ALVO) e evento no
 * outbox transacional na MESMA transação (ADR-003/ADR-004).
 */
import type { Invoice, Plan, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { DomainError } from './errors'
import { writeAudit } from './audit'
import { emitOutbox } from './outbox'
import { notify } from './notify'
import { parsePlanLimits } from './entitlements'
import type { ResolvedActor } from './actor'

type Tx = Prisma.TransactionClient

/** Excedente de parlamentares: R$ 25,00 por parlamentar acima do limite. */
export const PARLIAMENTARIAN_OVERAGE_CENTS = 2500
/** Excedente de sessões: R$ 40,00 por sessão acima do limite mensal. */
export const SESSION_OVERAGE_CENTS = 4000
/** Prazo de vencimento da fatura, em dias após a emissão. */
export const INVOICE_DUE_DAYS = 10

export const PAID_METHODS = ['pix', 'boleto', 'cartao', 'transferencia'] as const
export type PaidMethod = (typeof PAID_METHODS)[number]

export const PAID_METHOD_LABEL: Record<PaidMethod, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao: 'Cartão',
  transferencia: 'Transferência',
}

// ─── Formatação e helpers puros ─────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function fmtBrl(cents: number): string {
  return brl.format(cents / 100)
}

/** Rótulo da competência: "08/2026". */
export function periodLabel(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`
}

/** Limites mensais UTC do período [início, fim). */
function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

// ─── Uso x limites do plano ─────────────────────────────────────────────────

export type UsageMetrics = {
  sessions: number
  activeParliamentarians: number
  aiArtifacts: number
  webhookDeliveries: number
  /** Limites do plano vigente (null = sem limite / sem assinatura). */
  limits: { maxParliamentarians: number | null; maxSessionsPerMonth: number | null }
}

/**
 * Contadores de uso do tenant no período: sessões agendadas no mês,
 * parlamentares ativos (estado atual), artefatos de IA e entregas de
 * webhook criadas no mês — mais os limites do plano da assinatura.
 */
export async function computeUsage(
  tenantId: string,
  year: number,
  month: number,
  client: Tx | typeof db = db
): Promise<UsageMetrics> {
  const { start, end } = monthRange(year, month)
  const subscription = await client.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  })
  const parsed = subscription ? parsePlanLimits(subscription.plan.limits) : {}
  const [sessions, activeParliamentarians, aiArtifacts, webhookDeliveries] = await Promise.all([
    client.session.count({ where: { tenantId, scheduledAt: { gte: start, lt: end } } }),
    client.parliamentarian.count({ where: { tenantId, active: true } }),
    client.aiArtifact.count({ where: { tenantId, createdAt: { gte: start, lt: end } } }),
    client.webhookDelivery.count({
      where: { endpoint: { tenantId }, createdAt: { gte: start, lt: end } },
    }),
  ])
  return {
    sessions,
    activeParliamentarians,
    aiArtifacts,
    webhookDeliveries,
    limits: {
      maxParliamentarians:
        typeof parsed.maxParliamentarians === 'number' ? parsed.maxParliamentarians : null,
      maxSessionsPerMonth:
        typeof parsed.maxSessionsPerMonth === 'number' ? parsed.maxSessionsPerMonth : null,
    },
  }
}

// ─── Composição das linhas da fatura ────────────────────────────────────────

export type InvoiceLine = {
  description: string
  quantity: number
  unitCents: number
  totalCents: number
}

export type BuiltInvoiceLines = {
  lines: InvoiceLine[]
  subtotalCents: number
  discountCents: number
  totalCents: number
}

/**
 * Linhas da fatura (pura): ① mensalidade do plano; ② excedente de
 * parlamentares ativos (R$ 25/un); ③ excedente de sessões no mês (R$ 40/un).
 * Sem limite no plano → sem cobrança de excedente. Desconto = 0.
 */
export function buildInvoiceLines(
  plan: Pick<Plan, 'name' | 'priceCents'>,
  usage: {
    activeParliamentarians: number
    sessions: number
    limits: { maxParliamentarians: number | null; maxSessionsPerMonth: number | null }
  },
  year: number,
  month: number
): BuiltInvoiceLines {
  const lines: InvoiceLine[] = [
    {
      description: `Plano ${plan.name} — competência ${periodLabel(year, month)}`,
      quantity: 1,
      unitCents: plan.priceCents,
      totalCents: plan.priceCents,
    },
  ]

  const { maxParliamentarians, maxSessionsPerMonth } = usage.limits
  if (maxParliamentarians !== null && usage.activeParliamentarians > maxParliamentarians) {
    const excess = usage.activeParliamentarians - maxParliamentarians
    lines.push({
      description: `Excedente de parlamentares (${excess} acima do limite ${maxParliamentarians})`,
      quantity: excess,
      unitCents: PARLIAMENTARIAN_OVERAGE_CENTS,
      totalCents: excess * PARLIAMENTARIAN_OVERAGE_CENTS,
    })
  }
  if (maxSessionsPerMonth !== null && usage.sessions > maxSessionsPerMonth) {
    const excess = usage.sessions - maxSessionsPerMonth
    lines.push({
      description: `Excedente de sessões (${excess} acima do limite ${maxSessionsPerMonth})`,
      quantity: excess,
      unitCents: SESSION_OVERAGE_CENTS,
      totalCents: excess * SESSION_OVERAGE_CENTS,
    })
  }

  const subtotalCents = lines.reduce((acc, l) => acc + l.totalCents, 0)
  const discountCents = 0
  return { lines, subtotalCents, discountCents, totalCents: subtotalCents - discountCents }
}

// ─── Geração por tenant/período ─────────────────────────────────────────────

export type InvoiceSkipReason =
  | 'duplicate_period'
  | 'tenant_not_found'
  | 'tenant_inactive'
  | 'no_subscription'
  | 'subscription_canceled'

export const INVOICE_SKIP_REASON_LABEL: Record<InvoiceSkipReason, string> = {
  duplicate_period: 'Já existe fatura emitida para este tenant na competência informada.',
  tenant_not_found: 'Tenant não encontrado.',
  tenant_inactive: 'Tenant está desativado — faturamento suspenso.',
  no_subscription: 'Tenant não possui assinatura de plano.',
  subscription_canceled: 'Assinatura do tenant está cancelada.',
}

export type GenerateInvoiceResult =
  | { skipped: true; reason: InvoiceSkipReason }
  | { skipped: false; invoice: Invoice }

/**
 * Gera a fatura do tenant para a competência (transacional): valida
 * tenant/assinatura, pula quando já existe fatura do período, conta o uso,
 * compõe as linhas, emite com vencimento em 10 dias, grava auditoria
 * (cadeia do tenant ALVO) e evento `billing.invoice_created` no outbox.
 */
export async function generateInvoiceForTenant(
  tx: Tx,
  tenantId: string,
  year: number,
  month: number,
  opts: { actor: Pick<ResolvedActor, 'name' | 'role'>; correlationId: string }
): Promise<GenerateInvoiceResult> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    include: { subscription: { include: { plan: true } } },
  })
  if (!tenant) return { skipped: true, reason: 'tenant_not_found' }
  if (!tenant.active) return { skipped: true, reason: 'tenant_inactive' }
  if (!tenant.subscription) return { skipped: true, reason: 'no_subscription' }
  if (tenant.subscription.status === 'canceled') {
    return { skipped: true, reason: 'subscription_canceled' }
  }

  const existing = await tx.invoice.findFirst({
    where: { tenantId, periodYear: year, periodMonth: month },
    select: { id: true },
  })
  if (existing) return { skipped: true, reason: 'duplicate_period' }

  const usage = await computeUsage(tenantId, year, month, tx)
  const built = buildInvoiceLines(tenant.subscription.plan, usage, year, month)

  const last = await tx.invoice.findFirst({
    where: { tenantId },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  const number = (last?.number ?? 0) + 1

  const issuedAt = new Date()
  const dueAt = new Date(issuedAt.getTime() + INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000)

  const invoice = await tx.invoice.create({
    data: {
      tenantId,
      number,
      periodYear: year,
      periodMonth: month,
      status: 'open',
      lines: JSON.stringify(built.lines),
      subtotalCents: built.subtotalCents,
      discountCents: built.discountCents,
      totalCents: built.totalCents,
      issuedAt,
      dueAt,
    },
  })

  await writeAudit(tx, {
    tenantId: invoice.tenantId,
    actor: opts.actor,
    action: 'billing.invoice_created',
    aggregateType: 'invoice',
    aggregateId: invoice.id,
    summary:
      `Fatura nº ${invoice.number}/${invoice.periodYear} (competência ${periodLabel(year, month)}) ` +
      `emitida para ${tenant.name} — ${fmtBrl(invoice.totalCents)}, vencimento em ${dueAt.toLocaleDateString('pt-BR')}.`,
    after: {
      number: invoice.number,
      periodYear: year,
      periodMonth: month,
      status: 'open',
      subtotalCents: invoice.subtotalCents,
      totalCents: invoice.totalCents,
    },
    correlationId: opts.correlationId,
  })

  await emitOutbox(tx, {
    tenantId: invoice.tenantId,
    eventType: 'billing.invoice_created',
    aggregateId: invoice.id,
    aggregateVersion: 1,
    origin: 'cloud',
    correlationId: opts.correlationId,
    internalPayload: {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      tenantName: tenant.name,
      number: invoice.number,
      numberLabel: `${String(invoice.number).padStart(4, '0')}/${invoice.periodYear}`,
      periodYear: year,
      periodMonth: month,
      periodLabel: periodLabel(year, month),
      totalCents: invoice.totalCents,
      status: 'open',
      dueAt: dueAt.toISOString(),
    },
    publicPayload: {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      number: invoice.number,
      periodYear: year,
      periodMonth: month,
      totalCents: invoice.totalCents,
      status: 'open',
    },
  })

  return { skipped: false, invoice }
}

// ─── Ciclo mensal + dunning ─────────────────────────────────────────────────

export type BillingCycleResult = { generated: number; skipped: number; dunning: number }

/**
 * Executa o ciclo de faturamento do MÊS CORRENTE (transacional):
 *  1. gera a fatura do mês para cada tenant ativo com assinatura
 *     trial/active/past_due (skips contam como ignorados);
 *  2. dunning das faturas abertas vencidas: assinatura trial/active →
 *     past_due + notificação ao tenant_admin + evento `billing.invoice_overdue`
 *     (idempotente: assinaturas já past_due/canceled não são reprocessadas).
 */
export async function runBillingCycle(
  tx: Tx,
  opts: { actor: Pick<ResolvedActor, 'name' | 'role'>; correlationId: string }
): Promise<BillingCycleResult> {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1

  const tenants = await tx.tenant.findMany({
    where: { active: true, subscription: { status: { in: ['trial', 'active', 'past_due'] } } },
    select: { id: true },
  })

  let generated = 0
  let skipped = 0
  for (const tenant of tenants) {
    const result = await generateInvoiceForTenant(tx, tenant.id, year, month, opts)
    if (result.skipped) skipped += 1
    else generated += 1
  }

  let dunning = 0
  const overdueInvoices = await tx.invoice.findMany({
    where: { status: 'open', dueAt: { lt: now } },
    include: { tenant: { include: { subscription: true } } },
  })
  for (const invoice of overdueInvoices) {
    const subscription = invoice.tenant.subscription
    if (!subscription || (subscription.status !== 'trial' && subscription.status !== 'active')) {
      continue
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'past_due' },
    })

    await notify(tx, {
      tenantId: invoice.tenantId,
      title: 'Fatura vencida',
      body:
        `A fatura nº ${invoice.number}/${invoice.periodYear} (competência ` +
        `${periodLabel(invoice.periodYear, invoice.periodMonth)}) venceu em ` +
        `${invoice.dueAt.toLocaleDateString('pt-BR')} e segue em aberto — total ${fmtBrl(invoice.totalCents)}. ` +
        'A assinatura foi marcada como "em atraso"; regularize o pagamento com a operação da plataforma.',
      kind: 'system',
      targetRole: 'tenant_admin',
    })

    await writeAudit(tx, {
      tenantId: invoice.tenantId,
      actor: opts.actor,
      action: 'billing.dunning_past_due',
      aggregateType: 'invoice',
      aggregateId: invoice.id,
      summary:
        `Dunning: fatura nº ${invoice.number}/${invoice.periodYear} vencida em ` +
        `${invoice.dueAt.toLocaleDateString('pt-BR')} (${fmtBrl(invoice.totalCents)}) — assinatura de ` +
        `${invoice.tenant.name} marcada como past_due e administrador notificado.`,
      before: { subscriptionStatus: subscription.status },
      after: { subscriptionStatus: 'past_due' },
      correlationId: opts.correlationId,
    })

    await emitOutbox(tx, {
      tenantId: invoice.tenantId,
      eventType: 'billing.invoice_overdue',
      aggregateId: invoice.id,
      aggregateVersion: 1,
      origin: 'cloud',
      correlationId: opts.correlationId,
      internalPayload: {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        number: invoice.number,
        dueAt: invoice.dueAt.toISOString(),
        totalCents: invoice.totalCents,
      },
      publicPayload: {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        number: invoice.number,
        dueAt: invoice.dueAt.toISOString(),
        totalCents: invoice.totalCents,
      },
    })

    dunning += 1
  }

  return { generated, skipped, dunning }
}

// ─── Pagamento e cancelamento ───────────────────────────────────────────────

/** Registra o pagamento de uma fatura ABERTA; assinatura past_due reativa. */
export async function payInvoice(
  tx: Tx,
  invoice: Invoice,
  method: PaidMethod,
  actor: Pick<ResolvedActor, 'name' | 'role'>,
  correlationId: string
): Promise<Invoice> {
  if (invoice.status !== 'open') {
    throw new DomainError(
      'INVOICE_INVALID_TRANSITION',
      409,
      'Fatura não está aberta',
      `A fatura nº ${invoice.number}/${invoice.periodYear} não pode receber pagamento: ` +
        `status atual "${invoice.status}" (apenas faturas abertas aceitam registro de pagamento).`
    )
  }

  const paidAt = new Date()
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: { status: 'paid', paidAt, paidMethod: method },
  })

  const subscription = await tx.subscription.findUnique({ where: { tenantId: invoice.tenantId } })
  let reactivated = false
  if (subscription && subscription.status === 'past_due') {
    await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'active' } })
    reactivated = true
  }

  await writeAudit(tx, {
    tenantId: invoice.tenantId,
    actor,
    action: 'billing.invoice_paid',
    aggregateType: 'invoice',
    aggregateId: invoice.id,
    summary:
      `Fatura nº ${invoice.number}/${invoice.periodYear} (competência ` +
      `${periodLabel(invoice.periodYear, invoice.periodMonth)}) paga via ${PAID_METHOD_LABEL[method]} — ` +
      `${fmtBrl(invoice.totalCents)}${reactivated ? '; assinatura reativada (past_due → active)' : ''}.`,
    before: { status: 'open' },
    after: { status: 'paid', paidAt: paidAt.toISOString(), paidMethod: method },
    correlationId,
  })

  await emitOutbox(tx, {
    tenantId: invoice.tenantId,
    eventType: 'billing.invoice_paid',
    aggregateId: invoice.id,
    aggregateVersion: 1,
    origin: 'operator',
    correlationId,
    internalPayload: {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      number: invoice.number,
      totalCents: invoice.totalCents,
      method,
      paidAt: paidAt.toISOString(),
    },
    publicPayload: {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      number: invoice.number,
      totalCents: invoice.totalCents,
      method,
    },
  })

  return updated
}

/** Cancela uma fatura ABERTA com justificativa obrigatória (auditada). */
export async function cancelInvoice(
  tx: Tx,
  invoice: Invoice,
  justification: string,
  actor: Pick<ResolvedActor, 'name' | 'role'>,
  correlationId: string
): Promise<Invoice> {
  if (invoice.status !== 'open') {
    throw new DomainError(
      'INVOICE_INVALID_TRANSITION',
      409,
      'Fatura não está aberta',
      `A fatura nº ${invoice.number}/${invoice.periodYear} não pode ser cancelada: ` +
        `status atual "${invoice.status}" (apenas faturas abertas aceitam cancelamento).`
    )
  }

  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: { status: 'canceled', notes: justification },
  })

  await writeAudit(tx, {
    tenantId: invoice.tenantId,
    actor,
    action: 'billing.invoice_canceled',
    aggregateType: 'invoice',
    aggregateId: invoice.id,
    summary:
      `Fatura nº ${invoice.number}/${invoice.periodYear} (competência ` +
      `${periodLabel(invoice.periodYear, invoice.periodMonth)}) cancelada — ${fmtBrl(invoice.totalCents)}. ` +
      `Justificativa: ${justification}`,
    before: { status: 'open', totalCents: invoice.totalCents },
    after: { status: 'canceled' },
    justification,
    correlationId,
  })

  return updated
}

// ─── Serialização ───────────────────────────────────────────────────────────

export type InvoiceLineView = InvoiceLine

export type InvoiceView = {
  id: string
  tenantId: string
  tenantName: string | null
  number: number
  numberLabel: string
  periodYear: number
  periodMonth: number
  periodLabel: string
  status: string
  isOverdue: boolean
  lines: InvoiceLineView[]
  subtotalCents: number
  discountCents: number
  totalCents: number
  issuedAt: string
  dueAt: string
  paidAt: string | null
  paidMethod: string | null
  notes: string | null
}

function parseInvoiceLines(raw: string): InvoiceLineView[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (l): l is InvoiceLineView =>
          !!l &&
          typeof l === 'object' &&
          typeof (l as InvoiceLineView).description === 'string' &&
          typeof (l as InvoiceLineView).quantity === 'number' &&
          typeof (l as InvoiceLineView).unitCents === 'number' &&
          typeof (l as InvoiceLineView).totalCents === 'number'
      )
      .map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitCents: l.unitCents,
        totalCents: l.totalCents,
      }))
  } catch {
    return []
  }
}

/** Serialização da Invoice para a API (linhas parseadas + isOverdue computado). */
export function invoiceView(
  invoice: Invoice & { tenant?: { name: string } },
  tenantName?: string | null
): InvoiceView {
  const now = new Date()
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    tenantName: tenantName ?? invoice.tenant?.name ?? null,
    number: invoice.number,
    numberLabel: `${String(invoice.number).padStart(4, '0')}/${invoice.periodYear}`,
    periodYear: invoice.periodYear,
    periodMonth: invoice.periodMonth,
    periodLabel: periodLabel(invoice.periodYear, invoice.periodMonth),
    status: invoice.status,
    isOverdue: invoice.status === 'open' && invoice.dueAt.getTime() < now.getTime(),
    lines: parseInvoiceLines(invoice.lines),
    subtotalCents: invoice.subtotalCents,
    discountCents: invoice.discountCents,
    totalCents: invoice.totalCents,
    issuedAt: invoice.issuedAt.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    paidMethod: invoice.paidMethod,
    notes: invoice.notes,
  }
}
