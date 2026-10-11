/**
 * Fase 20 — alertas operacionais persistentes (PlatformAlert).
 *
 * Antes da Fase 20 os alertas do system-status eram efêmeros (derivados a
 * cada leitura e jogados fora). Agora são PERSISTIDOS com deduplicação por
 * `kind` enquanto abertos (ackAt null) e ganham ciclo de reconhecimento
 * auditado. Helpers compartilhados entre system-status (derive+persist),
 * /platform/alerts (lista) e /platform/alerts/:id/ack.
 */
import type { PlatformAlert } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import type { PlatformAlertView } from '@/lib/contracts'

/** Severidade derivada (info|warn|critical) → persistida (info|warning|critical). */
const SEVERITY_MAP: Record<string, PlatformAlertView['severity']> = {
  info: 'info',
  warn: 'warning',
  warning: 'warning',
  critical: 'critical',
}

export function toPlatformAlertView(a: PlatformAlert): PlatformAlertView {
  return {
    id: a.id,
    kind: a.kind,
    severity: (a.severity as PlatformAlertView['severity']) ?? 'warning',
    message: a.message,
    actionHint: a.actionHint ?? null,
    createdAt: a.createdAt.toISOString(),
    ackAt: a.ackAt ? a.ackAt.toISOString() : null,
    ackBy: a.ackBy ?? null,
  }
}

/** Abertos primeiro (mais recentes primeiro); reconhecidos por ack mais recente. */
export function compareAlertViews(a: PlatformAlertView, b: PlatformAlertView): number {
  const aOpen = a.ackAt ? 1 : 0
  const bOpen = b.ackAt ? 1 : 0
  if (aOpen !== bOpen) return aOpen - bOpen
  if (aOpen === 0) return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  return new Date(b.ackAt ?? 0).getTime() - new Date(a.ackAt ?? 0).getTime()
}

/** Lista persistida (abertos primeiro, depois reconhecidos), máx `take`. */
export async function listPlatformAlertViews(take: number): Promise<PlatformAlertView[]> {
  const rows = await db.platformAlert.findMany({
    orderBy: { createdAt: 'desc' },
    take: take * 2, // folga antes do reordenamento (abertos primeiro)
  })
  return rows.map(toPlatformAlertView).sort(compareAlertViews).slice(0, take)
}

/**
 * UPSERT deduplicado dos alertas DERIVADOS do system-status (Fase 20): para
 * cada alerta derivado SEM PlatformAlert ABERTO do mesmo kind → cria; quando
 * já existe aberto → não duplica. Roda em transação (o mutex in-process de
 * withTransaction serializa leituras concorrentes do polling de 30s do
 * Console/Suporte, evitando duplicatas).
 */
export async function persistDerivedAlerts(
  derived: Array<{
    id: string
    severity: 'info' | 'warn' | 'critical'
    title: string
    action: string
  }>
): Promise<void> {
  if (derived.length === 0) return
  await withTransaction(async (tx) => {
    for (const d of derived) {
      const open = await tx.platformAlert.findFirst({
        where: { kind: d.id, ackAt: null },
        select: { id: true },
      })
      if (!open) {
        await tx.platformAlert.create({
          data: {
            kind: d.id,
            severity: SEVERITY_MAP[d.severity] ?? 'warning',
            message: d.title,
            actionHint: d.action,
            meta: JSON.stringify({ derived: true, source: 'system-status' }),
          },
        })
      }
    }
  })
}

/**
 * Tenant da cadeia de auditoria para eventos de alerta da plataforma
 * (decisão documentada — a cadeia ADR-004 é por tenant e o PlatformAlert é
 * global): usa o tenant indicado no `meta` (tenantId/tenantSlug) quando
 * existir e for válido; senão o tenant ativo mais antigo (âncora da operação
 * da plataforma no sandbox multi-tenant).
 */
export async function alertAuditTenantId(metaRaw: string): Promise<string> {
  try {
    const meta = JSON.parse(metaRaw) as { tenantId?: string; tenantSlug?: string }
    if (meta.tenantId) {
      const byId = await db.tenant.findUnique({
        where: { id: meta.tenantId },
        select: { id: true },
      })
      if (byId) return byId.id
    }
    if (meta.tenantSlug) {
      const bySlug = await db.tenant.findUnique({
        where: { slug: meta.tenantSlug },
        select: { id: true },
      })
      if (bySlug) return bySlug.id
    }
  } catch {
    // meta inválida — usa a âncora abaixo
  }
  const first = await db.tenant.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!first) {
    throw new Error('Nenhum tenant ativo para ancorar a auditoria do alerta.')
  }
  return first.id
}
