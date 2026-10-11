import type { PrismaClient } from '@prisma/client'
import { gatherTenantHealthMetrics, healthScoreFromMetrics } from '../../src/lib/server/tenant-health'

export type KindResult = { status: 'ok' | 'error' | 'skipped'; note: string }
export const KNOWN_KINDS = ['alert.scan', 'export.watchdog', 'health.check', 'tenant.health_snapshot', 'notice.deadline_alerts'] as const
type AlertSpec = { kind: string; severity: string; message: string; actionHint: string; meta: Record<string, unknown>; key: string; value: string }
type Probe = (url: string) => Promise<boolean>
const SERVICES = [
  { key: 'realtime', label: 'Tempo real (socket.io, porta 3003)', url: 'http://localhost:3003/' },
  { key: 'webhooks', label: 'Entregas de webhook (porta 3004)', url: 'http://localhost:3004/' },
]

export function createPostgresScheduler(db: PrismaClient, probe: Probe) {
  async function upsertAlert(spec: AlertSpec): Promise<boolean> {
    const open = await db.platformAlert.findMany({ where: { kind: spec.kind, ackAt: null }, select: { meta: true } })
    const exists = open.some((row) => {
      try { return String((JSON.parse(row.meta) as Record<string, unknown>)[spec.key] ?? '') === spec.value }
      catch { return false }
    })
    if (exists) return false
    await db.platformAlert.create({ data: {
      kind: spec.kind, severity: spec.severity, message: spec.message,
      actionHint: spec.actionHint, meta: JSON.stringify(spec.meta),
    } })
    return true
  }

  async function alertScan(now: Date): Promise<KindResult> {
    let conditions = 0
    const overdue = await db.invoice.groupBy({ by: ['tenantId'], where: {
      status: 'open', dueAt: { lt: new Date(now.getTime() - 3 * 86400_000) },
    }, _count: { _all: true } })
    const invoiceTenants = await db.tenant.findMany({ where: { id: { in: overdue.map((row) => row.tenantId) } } })
    const tenantById = new Map(invoiceTenants.map((tenant) => [tenant.id, tenant]))
    for (const { tenantId, _count } of overdue) {
      const tenant = tenantById.get(tenantId)
      if (!tenant) continue
      const count = _count._all
      conditions++
      await upsertAlert({
        kind: 'billing.invoice_overdue', severity: 'warning',
        message: `Faturas vencidas há mais de 3 dias: "${tenant.name}" tem ${count} fatura(s) em aberto.`,
        actionHint: 'Registre o pagamento ou execute o ciclo de cobrança em Console da Plataforma → Faturamento.',
        meta: { tenantSlug: tenant.slug, tenantId, overdueCount: count }, key: 'tenantSlug', value: tenant.slug,
      })
    }
    const sessions = await db.session.findMany({ where: {
      status: 'scheduled', agendaPublished: false,
      scheduledAt: { gte: now, lte: new Date(now.getTime() + 48 * 3600_000) },
    }, include: { tenant: true } })
    for (const session of sessions) {
      conditions++
      const day = session.scheduledAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      await upsertAlert({
        kind: 'session.no_agenda', severity: 'warning',
        message: `Sessão nº ${session.number}/${session.year} de "${session.tenant.name}" agendada para ${day} sem pauta publicada.`,
        actionHint: 'Publique a pauta em Sessões → Pauta da Ordem do Dia antes da sessão ocorrer.',
        meta: { sessionId: session.id, tenantId: session.tenantId, tenantSlug: session.tenant.slug },
        key: 'sessionId', value: session.id,
      })
    }
    const dead = await db.webhookDelivery.groupBy({ by: ['endpointId'], where: { status: 'dead' }, _count: { _all: true } })
    const endpoints = await db.webhookEndpoint.findMany({
      where: { id: { in: dead.map((row) => row.endpointId) } }, include: { tenant: true },
    })
    const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]))
    for (const { endpointId, _count } of dead) {
      const endpoint = endpointById.get(endpointId)
      if (!endpoint) continue
      const count = _count._all
      conditions++
      await upsertAlert({
        kind: 'webhook.dead_letter', severity: 'warning',
        message: `${count} entrega(s) de webhook em dead-letter para ${endpoint.url} ("${endpoint.tenant.name}").`,
        actionHint: 'Reprocesse as entregas ou desative o endpoint no módulo Webhooks.',
        meta: { endpointId, tenantId: endpoint.tenantId, tenantSlug: endpoint.tenant.slug, deadCount: count },
        key: 'endpointId', value: endpointId,
      })
    }
    return { status: 'ok', note: `Varredura: ${conditions} condições avaliadas, ${conditions} alertas criados/existentes` }
  }

  async function exportWatchdog(now: Date): Promise<KindResult> {
    const stale = await db.exportJob.findMany({ where: {
      status: 'running', createdAt: { lte: new Date(now.getTime() - 10 * 60_000) },
    }, include: { tenant: true } })
    let changed = 0
    for (const job of stale) {
      const result = await db.exportJob.updateMany({ where: { id: job.id, status: 'running' }, data: {
        status: 'failed', finishedAt: now,
        error: 'Job órfão: execução interrompida (running há mais de 10 min) — marcado pelo watchdog do scheduler.',
      } })
      if (result.count === 0) continue
      changed++
      await upsertAlert({
        kind: 'export.orphan', severity: 'warning',
        message: `Job de exportação órfão ${job.id} ("${job.tenant.name}") parado em running há mais de 10 minutos.`,
        actionHint: 'Reprocesse o job no módulo Suporte da Plataforma (card "Watchdog de exportações" → Reprocessar).',
        meta: { jobId: job.id, tenantId: job.tenantId, tenantSlug: job.tenant.slug },
        key: 'jobId', value: job.id,
      })
    }
    return { status: 'ok', note: `${changed} órfão(s) detectado(s) e marcado(s) como failed.` }
  }

  async function healthCheck(): Promise<KindResult> {
    const results: string[] = []
    let allOk = true
    for (const service of SERVICES) {
      const alive = await probe(service.url)
      results.push(`${service.key} ${alive ? 'ok' : 'fora'}`)
      if (alive) continue
      allOk = false
      await upsertAlert({
        kind: 'service.degraded', severity: 'warning',
        message: `Serviço ${service.label} sem resposta no health check agendado.`,
        actionHint: 'Reinicie o serviço seguindo o runbook (docs/runbook.md).',
        meta: { service: service.key }, key: 'service', value: service.key,
      })
    }
    let dbOk = false
    try { await db.tenant.count(); dbOk = true } catch { /* health report */ }
    results.push(`db ${dbOk ? 'ok' : 'fora'}`)
    if (!dbOk) allOk = false
    return { status: allOk ? 'ok' : 'error', note: results.join(' · ') }
  }

  async function tenantHealthSnapshot(now: Date): Promise<KindResult> {
    const tenants = await db.tenant.findMany({ where: { active: true }, select: { id: true, slug: true } })
    const captured: number[] = []
    let skipped = 0
    for (const tenant of tenants) {
      const last = await db.tenantHealthSnapshot.findFirst({ where: { tenantId: tenant.id }, orderBy: { capturedAt: 'desc' } })
      if (last?.capturedAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) { skipped++; continue }
      const metrics = await gatherTenantHealthMetrics(db, tenant.id, now)
      const { score } = healthScoreFromMetrics(metrics)
      await db.tenantHealthSnapshot.create({ data: { tenantId: tenant.id, score, metrics: JSON.stringify(metrics), capturedAt: now } })
      captured.push(score)
    }
    return { status: 'ok', note: `${captured.length} tenants capturados (${captured.join('/')}) · ${skipped} ignorado(s)` }
  }

  async function runKind(kind: string, now = new Date()): Promise<KindResult> {
    switch (kind) {
      case 'alert.scan': return alertScan(now)
      case 'export.watchdog': return exportWatchdog(now)
      case 'health.check': return healthCheck()
      case 'tenant.health_snapshot': return tenantHealthSnapshot(now)
      case 'notice.deadline_alerts': {
        const { scanNoticeDeadlineAlerts } = await import('../../src/lib/server/notice-deadline-alerts')
        const result = await scanNoticeDeadlineAlerts(now)
        return { status: 'ok', note: `${result.due} prazo(s) em atenção; ${result.created} notificação(ões) nova(s).` }
      }
      default: throw new Error(`Kind de agendamento desconhecido: "${kind}".`)
    }
  }

  async function tick(now = new Date()): Promise<number> {
    const due = await db.scheduledJob.findMany({ where: { active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' } })
    for (const job of due) {
      let result: KindResult
      try { result = await runKind(job.kind, now) }
      catch (error) { result = { status: 'error', note: String(error).slice(0, 300) } }
      const finishedAt = new Date()
      await db.scheduledJob.update({ where: { id: job.id }, data: {
        lastRunAt: finishedAt, lastStatus: result.status, lastNote: result.note,
        nextRunAt: new Date(finishedAt.getTime() + job.everySeconds * 1000),
      } })
    }
    return due.length
  }

  return { runKind, tick }
}
