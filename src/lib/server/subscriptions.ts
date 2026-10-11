/**
 * Domínio de assinaturas do cidadão (Fase 19, ADR-020) — helpers
 * compartilhados entre as rotas /api/v1/public/subscriptions* (dupla
 * confirmação anônima) e /api/v1/subscriptions (gestão pelo tenant).
 *
 * Regras centrais:
 *  - e-mail normalizado (trim + lowercase) na fronteira das rotas públicas;
 *  - o alvo (matéria/sessão/audiência) precisa EXISTIR no tenant — sessão em
 *    rascunho e audiência cancelada não são acompanháveis (nunca aparecem no
 *    portal público);
 *  - rótulo do alvo: matéria "PL 44/2026 — ementa (até 60 chars)", sessão usa
 *    o rótulo regimental existente e audiência usa o título;
 *  - e-mail do cidadão NUNCA é exposto publicamente sem máscara (LGPD).
 */
import type { CitizenSubscription, LegislativeMatter, Session } from '@prisma/client'
import { db } from '@/lib/db'
import {
  MATTER_TYPE_SHORT,
  SESSION_TYPE_LABEL,
  type CitizenSubscriptionView,
  type SessionType,
  type SubscriptionTargetKind,
} from '@/lib/contracts'

export const SUBSCRIPTION_TARGET_KINDS: SubscriptionTargetKind[] = ['matter', 'session', 'hearing']

/** Rótulo de alvo do tipo matéria: "PL 44/2026 — ementa curta (60 chars)". */
export function matterTargetLabel(m: LegislativeMatter): string {
  const base = `${MATTER_TYPE_SHORT[m.type as keyof typeof MATTER_TYPE_SHORT] ?? 'MAT'} ${m.number}/${m.year}`
  const ementa = m.ementa.trim()
  if (!ementa) return base
  const short = ementa.length > 60 ? `${ementa.slice(0, 59).trimEnd()}…` : ementa
  return `${base} — ${short}`
}

/** Rótulo de alvo do tipo sessão: "Sessão Ordinária nº 2/2026". */
export function sessionTargetLabel(s: Session): string {
  return `${SESSION_TYPE_LABEL[s.type as SessionType] ?? 'Sessão'} nº ${s.number}/${s.year}`
}

/** E-mail mascarado para respostas públicas: jo***@dominio. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const head = email.slice(0, Math.min(2, at))
  return `${head}***${email.slice(at)}`
}

/**
 * Valida a existência do alvo no tenant e devolve o rótulo, ou null quando o
 * alvo não existe / pertence a outro tenant / não é publicamente acompanhável.
 */
export async function resolveSubscriptionTarget(
  tenantId: string,
  kind: SubscriptionTargetKind,
  targetId: string
): Promise<string | null> {
  if (kind === 'matter') {
    const m = await db.legislativeMatter.findUnique({ where: { id: targetId } })
    return m && m.tenantId === tenantId ? matterTargetLabel(m) : null
  }
  if (kind === 'session') {
    const s = await db.session.findUnique({ where: { id: targetId } })
    // Rascunho de sessão não é público — não pode ser acompanhado.
    return s && s.tenantId === tenantId && s.status !== 'draft' ? sessionTargetLabel(s) : null
  }
  const h = await db.publicHearing.findUnique({ where: { id: targetId } })
  // Audiência cancelada não aparece no portal — não é acompanhável.
  return h && h.tenantId === tenantId && h.status !== 'canceled' ? h.title : null
}

/** View de assinatura (contracts.ts) — NUNCA inclui o token de confirmação. */
export function toCitizenSubscriptionView(
  s: CitizenSubscription,
  targetLabel: string | null
): CitizenSubscriptionView {
  return {
    id: s.id,
    email: s.email,
    targetKind: s.targetKind as SubscriptionTargetKind,
    targetId: s.targetId,
    targetLabel,
    confirmedAt: s.confirmedAt?.toISOString() ?? null,
    revokedAt: s.revokedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }
}

/**
 * Rótulos em lote para a listagem do tenant: devolve Map
 * `${targetKind}:${targetId}` → label (alvo removido → ausente do Map).
 */
export async function batchTargetLabels(
  subs: Array<Pick<CitizenSubscription, 'tenantId' | 'targetKind' | 'targetId'>>
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  const byKind = (kind: SubscriptionTargetKind) =>
    subs.filter((s) => s.targetKind === kind).map((s) => s.targetId)

  const matterIds = byKind('matter')
  if (matterIds.length > 0) {
    for (const m of await db.legislativeMatter.findMany({ where: { id: { in: matterIds } } })) {
      labels.set(`matter:${m.id}`, matterTargetLabel(m))
    }
  }

  const sessionIds = byKind('session')
  if (sessionIds.length > 0) {
    for (const s of await db.session.findMany({ where: { id: { in: sessionIds } } })) {
      labels.set(`session:${s.id}`, sessionTargetLabel(s))
    }
  }

  const hearingIds = byKind('hearing')
  if (hearingIds.length > 0) {
    for (const h of await db.publicHearing.findMany({ where: { id: { in: hearingIds } } })) {
      labels.set(`hearing:${h.id}`, h.title)
    }
  }
  return labels
}
