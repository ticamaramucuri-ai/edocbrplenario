/**
 * GET|DELETE /api/v1/subscriptions — gestão das assinaturas do cidadão pelo
 * tenant (Fase 19, ADR-020). RBAC `subscription.manage` (tenant_admin,
 * legislative_admin); escopo via resolveActor/resolveTenantScope (platform_*
 * usa ?tenant=slug). Dupla confirmação: revogação não apaga o registro
 * (histórico LGPD), apenas grava revokedAt — idempotente.
 *
 * GET: lista CitizenSubscriptionView[] com targetLabel resolvido (matéria
 * "PL 44/2026 — ementa curta", sessão regimental, título da audiência) +
 * SubscriptionStats { total (registro, incl. revogadas), confirmed (ativas
 * confirmadas), pending (ativas pendentes), byTarget (contagem confirmada
 * por alvo ativo) }. Ordenação: pendentes primeiro (mais antiga primeiro),
 * depois confirmadas (confirmação mais recente primeiro), revogadas por último.
 * Cada linha pendente/ativa inclui `confirmToken` — no sandbox não há SMTP e
 * a gestão copia o link de confirmação para demonstrar o double opt-in (em
 * produção o token só circula por e-mail; documentado no tooltip da UI).
 *
 * DELETE ?id=: revoga a assinatura do escopo (404 se de outro tenant) com
 * auditoria `subscription.revoked` (writeAudit, cadeia completa).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import type {
  CitizenSubscriptionView,
  SubscriptionStats,
  SubscriptionTargetKind,
} from '@/lib/contracts'
import { batchTargetLabels, toCitizenSubscriptionView } from '@/lib/server/subscriptions'
import { demoModeEnabled } from '@/lib/server/demo-mode'

export const dynamic = 'force-dynamic'

type SubscriptionRow = CitizenSubscriptionView & { confirmToken: string | null }

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'subscription.manage')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)

  const subscriptions = await db.citizenSubscription.findMany({ where: { tenantId } })
  const labels = await batchTargetLabels(subscriptions)

  const views = subscriptions.map((s) => ({
    ...toCitizenSubscriptionView(s, labels.get(`${s.targetKind}:${s.targetId}`) ?? null),
    // Token exposto APENAS para pendentes ativas (copiar link de confirmação
    // no sandbox); confirmadas/revogadas não precisam e não recebem.
    confirmToken: demoModeEnabled() && !s.confirmedAt && !s.revokedAt ? s.token : null,
  }))

  // Pendentes primeiro (mais antiga primeiro) → confirmadas (confirmação
  // mais recente primeiro) → revogadas por último (revogação mais recente).
  const ordered = [...views].sort((a, b) => {
    const rank = (v: SubscriptionRow) => (v.revokedAt ? 2 : v.confirmedAt ? 1 : 0)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (rank(a) === 0) return a.createdAt.localeCompare(b.createdAt)
    if (rank(a) === 1) return (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? '')
    return (b.revokedAt ?? '').localeCompare(a.revokedAt ?? '')
  })

  // Stats: total = registro completo (incl. revogadas); confirmed/pending
  // contam apenas ATIVAS; byTarget agrupa alvos ativos com confirmadas.
  const active = views.filter((v) => !v.revokedAt)
  const confirmedActive = active.filter((v) => v.confirmedAt)
  const byTargetMap = new Map<string, { targetKind: SubscriptionTargetKind; targetId: string; targetLabel: string | null; confirmed: number }>()
  for (const v of active) {
    const key = `${v.targetKind}:${v.targetId}`
    const entry = byTargetMap.get(key) ?? {
      targetKind: v.targetKind,
      targetId: v.targetId,
      targetLabel: v.targetLabel,
      confirmed: 0,
    }
    if (v.confirmedAt) entry.confirmed += 1
    byTargetMap.set(key, entry)
  }
  const stats: SubscriptionStats = {
    total: views.length,
    confirmed: confirmedActive.length,
    pending: active.length - confirmedActive.length,
    byTarget: [...byTargetMap.values()].sort((a, b) => b.confirmed - a.confirmed),
  }

  return Response.json({ subscriptions: ordered, stats })
})

export const DELETE = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'subscription.manage')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)

  const id = new URL(req.url).searchParams.get('id')?.trim() ?? ''
  if (!id) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Parâmetro id é obrigatório.',
      { errors: { id: ['Informe o id da assinatura a revogar.'] } }
    )
  }

  const subscription = await db.citizenSubscription.findUnique({ where: { id } })
  if (!subscription) throw notFound('Assinatura não encontrada.')
  assertTenantScope(actor, subscription.tenantId)

  const labels = await batchTargetLabels([subscription])
  const targetLabel = labels.get(`${subscription.targetKind}:${subscription.targetId}`) ?? null

  // Idempotente: já revogada → 200 sem regravar/reauditar.
  if (subscription.revokedAt) {
    return Response.json({
      ok: true,
      message: 'Assinatura já estava revogada.',
      subscription: toCitizenSubscriptionView(subscription, targetLabel),
    })
  }

  const revokedAt = new Date()
  const revoked = await withTransaction(async (tx) => {
    const row = await tx.citizenSubscription.update({
      where: { id: subscription.id },
      data: { revokedAt },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'subscription.revoked',
      aggregateType: 'citizen_subscription',
      aggregateId: row.id,
      summary: `Assinatura de "${row.email}" para ${targetLabel ?? row.targetKind} revogada pela gestão.`,
      before: { confirmedAt: row.confirmedAt?.toISOString() ?? null, revokedAt: null },
      after: { revokedAt: revokedAt.toISOString() },
      correlationId,
      ip: clientIp(req),
    })
    return row
  })

  return Response.json({
    ok: true,
    message: 'Assinatura revogada — o cidadão deixará de receber novidades deste acompanhamento.',
    subscription: toCitizenSubscriptionView(revoked, targetLabel),
  })
})
