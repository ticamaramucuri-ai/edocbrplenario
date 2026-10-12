/**
 * GET /api/v1/platform/system-status — observabilidade operacional do SaaS
 * (Fase 16 / ADR-017): health dos mini-serviços com timeout curto (nunca 500
 * por serviço caído), tamanho do banco/WAL, filas (outbox pendente + idade do
 * mais antigo; entregas de webhook pendentes/mortas), atividade (tenants,
 * sessões de hoje, último evento auditado), runtime (uptime, heap) e
 * `alerts[]` derivados com ação sugerida.
 *
 * Fase 20: RBAC passa a ser `platform.read` (platform_support também lê — o
 * suporte precisa enxergar a operação); os alertas derivados são PERSISTIDOS
 * em PlatformAlert com dedupe por kind aberto (upsert) e a resposta ganha
 * `platformAlerts[]` (abertos primeiro + reconhecidos recentes, máx 20)
 * MANTENDO o campo `alerts` derivado para compatibilidade. O ack continua
 * exclusivo do owner (/platform/alerts/:id/ack, platform.manage).
 */
import { stat } from 'fs/promises'
import { join } from 'path'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import type { ServiceHealth, SystemStatusView } from '@/lib/contracts'
import { listPlatformAlertViews, persistDerivedAlerts } from '@/lib/server/platform-alerts'
import { mailTransportConfigured } from '@/lib/server/mail-delivery'

export const dynamic = 'force-dynamic'

/** Health check de um mini-serviço com timeout curto — degrada, nunca lança. */
async function checkService(id: string, name: string, url: string): Promise<ServiceHealth> {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), cache: 'no-store' })
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      return { id, name, url, ok: false, latencyMs, detail: `HTTP ${res.status} em /health` }
    }
    return { id, name, url, ok: true, latencyMs, detail: null }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    const raw = err instanceof Error ? err.message : String(err)
    const detail =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? 'Sem resposta em 2s (timeout)'
        : raw.length > 90
          ? `${raw.slice(0, 87)}…`
          : raw || 'Falha de rede'
    return { id, name, url, ok: false, latencyMs, detail }
  }
}

/** Tamanho de arquivo em bytes (null quando não existe) — caminho relativo ao cwd. */
async function fileSizeBytes(path: string): Promise<number | null> {
  try {
    const st = await stat(path)
    return st.size
  } catch {
    return null
  }
}

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  // Serviços (paralelo) + banco de dados (fs) + filas/atividade (Prisma).
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const mailConfigured = mailTransportConfigured()

  const dbDir = join(process.cwd(), 'db')
  const [
    realtime,
    webhooks,
    mailWorker,
    fileBytes,
    walBytes,
    outboxPending,
    oldestPending,
    webhookPending,
    webhookDead,
    mailPending,
    mailDead,
    mailOldestPending,
    tenantsTotal,
    tenantsActive,
    sessionsToday,
    lastAudit,
    subscriptionsPastDue,
  ] = await Promise.all([
    checkService('realtime', 'Tempo real (socket.io)', process.env.REALTIME_HEALTH_URL || 'http://localhost:3003/health'),
    checkService('webhooks', 'Entregas de webhook', process.env.WEBHOOKS_HEALTH_URL || 'http://localhost:3004/health'),
    mailConfigured ? checkService('mail', 'Worker de correio (processo)', process.env.MAIL_WORKER_HEALTH_URL || 'http://127.0.0.1:3006/health') : Promise.resolve(null),
    fileSizeBytes(join(dbDir, 'custom.db')),
    fileSizeBytes(join(dbDir, 'custom.db-wal')),
    db.outboxEvent.count({ where: { status: 'pending' } }),
    db.outboxEvent.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    db.webhookDelivery.count({ where: { status: 'pending' } }),
    db.webhookDelivery.count({ where: { status: 'dead' } }),
    db.mailDelivery.count({ where: { status: 'pending' } }),
    db.mailDelivery.count({ where: { status: 'dead' } }),
    db.mailDelivery.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.tenant.count(),
    db.tenant.count({ where: { active: true } }),
    db.session.count({ where: { scheduledAt: { gte: dayStart, lt: dayEnd } } }),
    db.auditEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.subscription.count({ where: { status: 'past_due' } }),
  ])

  const outboxOldestPendingMinutes = oldestPending
    ? Math.max(0, Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 60_000))
    : null

  const mem = process.memoryUsage()
  const mb = (x: number) => Number((x / 1024 / 1024).toFixed(1))

  const services = [realtime, webhooks, ...(mailWorker ? [mailWorker] : [])]

  // Alertas derivados — SEMPRE com ação sugerida (o banner nunca é só cor).
  const alerts: SystemStatusView['alerts'] = []
  for (const svc of services) {
    if (!svc.ok) {
      alerts.push({
        id: `service-down-${svc.id}`,
        severity: 'critical',
        title: `Serviço ${svc.name} parado`,
        action: 'Reinicie seguindo o runbook (docs/runbook.md) — comando de orfanamento documentado na Task 2-b.',
      })
    }
  }
  if (webhookDead > 0) {
    alerts.push({
      id: 'webhook-dead',
      severity: 'warn',
      title: `${webhookDead} entrega(s) de webhook em dead-letter`,
      action: 'Revise o módulo Webhooks: reprocesse ou desative o endpoint.',
    })
  }
  if (outboxPending > 10 || (outboxOldestPendingMinutes !== null && outboxOldestPendingMinutes > 5)) {
    alerts.push({
      id: 'outbox-backlog',
      severity: 'warn',
      title: `Backlog no outbox (${outboxPending} eventos, mais antigo há ${outboxOldestPendingMinutes ?? 0} min)`,
      action: 'Verifique o serviço de tempo real na porta 3003.',
    })
  }
  if (subscriptionsPastDue > 0) {
    alerts.push({
      id: 'tenants-past-due',
      severity: 'info',
      title: `${subscriptionsPastDue} tenant(s) inadimplente(s)`,
      action: 'Execute o ciclo de cobrança em Console → Faturamento.',
    })
  }

  const view: SystemStatusView = {
    checkedAt: now.toISOString(),
    services,
    database: { fileBytes: fileBytes ?? 0, walBytes },
    queues: { outboxPending, outboxOldestPendingMinutes, webhookPending, webhookDead,
      mailPending, mailDead, mailOldestPendingMinutes: mailOldestPending
        ? Math.max(0, Math.floor((now.getTime() - mailOldestPending.createdAt.getTime()) / 60_000)) : null },
    activity: {
      tenantsActive,
      tenantsTotal,
      sessionsToday,
      lastAuditAt: lastAudit ? lastAudit.createdAt.toISOString() : null,
    },
    runtime: {
      uptimeSeconds: Math.floor(process.uptime()),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
    },
    alerts,
  }

  // Fase 20 — persistência deduplicada dos alertas derivados (kind aberto já
  // existente NÃO duplica) + leitura da lista persistida para a resposta.
  await persistDerivedAlerts(alerts)
  const platformAlerts = await listPlatformAlertViews(20)

  return Response.json({ ...view, platformAlerts })
})
