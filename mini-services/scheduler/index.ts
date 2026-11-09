/**
 * Legis SaaS — mini-serviço SCHEDULER (Onda 5 / Fase 21 / ADR-022)
 * -------------------------------------------------------------------
 * Agendador de tarefas da plataforma: deixa o sistema de depender de gatilhos
 * pontuais para operar com verificações periódicas (alertas de negócio,
 * watchdog de jobs órfãos, health check dos serviços, snapshot de saúde dos
 * tenants).
 *
 *   - Tick de 30s: lê `ScheduledJob WHERE active = 1 AND nextRunAt <= agora`
 *     e, para cada job vencido: executa o kind, grava `lastRunAt/lastStatus/
 *     lastNote` na linha E recalcula `nextRunAt = agora + everySeconds*1000`.
 *     Erros são tratados POR JOB (um job falho não derruba o loop).
 *   - POST /jobs/:kind/run: executa o kind IMEDIATAMENTE e devolve
 *     `{ status: 'ok'|'error'|'skipped', note }` — usado pela rota de execução
 *     manual (POST /api/v1/platform/schedules/:id/run). NÃO atualiza a linha do
 *     job nem nextRunAt (quem grava o resultado é a rota; execução manual não
 *     adianta a agenda).
 *
 * Kinds (um singleton por kind na tabela):
 *   - alert.scan             → faturas vencidas > 3d (por tenant), sessões
 *                               agendadas ≤ 48h sem pauta, webhooks em
 *                               dead-letter → PlatformAlert DEDUPLICADA por
 *                               kind aberto + chave da meta.
 *   - export.watchdog        → ExportJob running há > 10 min → failed +
 *                               alerta persistente export.orphan.
 *   - health.check           → ping realtime :3003 / webhooks :3004 (qualquer
 *                               resposta HTTP = vivo; exceção = morto) +
 *                               SELECT 1 no banco → alerta service.degraded.
 *   - tenant.health_snapshot → captura diária do health score por tenant
 *                               (fórmula CANÔNICA importada de
 *                               src/lib/server/tenant-health — imports são
 *                               `import type`, apagados em runtime: seguro sob
 *                               Bun). No máximo 1 captura/dia/tenant.
 *   - notice.deadline_alerts → avisos internos de prazo de convocação,
 *                               idempotentes por Câmara/sessão/prazo/papel.
 *
 * IMPORTANTE (SQLite/Prisma): DateTime é armazenado como epoch MILLISECONDS
 * (INTEGER). Cortes de tempo em SQL SEMPRE com
 * `(strftime('%s','now') - N*86400) * 1000`, nunca datetime('now', ...).
 *
 * Banco: SQLite com PRAGMA busy_timeout=5000 + journal_mode=WAL e retries em
 * SQLITE_BUSY (este serviço ESCREVE — mesmo padrão do mini-serviço de
 * webhooks). Porta fixa 3005 · health check GET /health · logging JSON
 * conciso · graceful shutdown SIGTERM/SIGINT · `bun --hot` sobrevive a restart.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Database, type Statement, type SQLQueryBindings } from 'bun:sqlite'
import { resolve } from 'path'
import { healthScoreFromMetrics, TENANT_HEALTH_SQL } from '../../src/lib/server/tenant-health'

// ─── Configuração ───────────────────────────────────────────────────────────

const PORT = Number(process.env.SCHEDULER_PORT || 3005)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('SCHEDULER_PORT inválida.')
const DB_PATH = process.env.SCHEDULER_DB_PATH?.trim() || resolve(import.meta.dir, '../../db/custom.db')
process.env.DATABASE_URL ??= `file:${DB_PATH}?connection_limit=1&socket_timeout=30`
const TICK_INTERVAL_MS = 30_000
const HEALTH_TIMEOUT_MS = 2_000
const WATCHDOG_STALE_MS = 10 * 60_000 // export running há > 10 min = órfão
const INVOICE_OVERDUE_DAYS = 3
const SESSION_WINDOW_HOURS = 48

const SERVICES: Array<{ key: string; label: string; url: string }> = [
  { key: 'realtime', label: 'Tempo real (socket.io, porta 3003)', url: 'http://localhost:3003/' },
  { key: 'webhooks', label: 'Entregas de webhook (porta 3004)', url: 'http://localhost:3004/' },
  ...(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim() && process.env.PUBLIC_BASE_URL?.trim()
    ? [{ key: 'mail', label: 'Correio de confirmação (porta 3006)', url: process.env.MAIL_WORKER_HEALTH_URL || 'http://127.0.0.1:3006/health' }] : []),
]

// ─── Logging conciso em JSON ────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }))
}

// ─── Banco de dados (ESCRITA, com busy_timeout + WAL + retries) ─────────────

const db = new Database(DB_PATH, { strict: true })
db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA busy_timeout=5000')

interface JobRow {
  id: string
  kind: string
  title: string
  everySeconds: number
  lastRunAt: number | string | null
  nextRunAt: number | string
  lastStatus: string | null
  lastNote: string | null
  active: number
}

/** Executa uma escrita com retry em SQLITE_BUSY (até 3x / espera crescente). */
function runWrite(stmt: Statement, ...params: SQLQueryBindings[]): void {
  for (let attempt = 1; ; attempt++) {
    try {
      stmt.run(...params)
      return
    } catch (err) {
      const msg = String(err)
      if (msg.includes('SQLITE_BUSY') && attempt < 3) {
        const ms = 150 * attempt
        void Bun.sleep(ms)
        continue
      }
      throw err
    }
  }
}

/** SELECT com retry em SQLITE_BUSY (mesma proteção, para o tick). */
function runQuery<T>(stmt: Statement, ...params: SQLQueryBindings[]): T[] {
  for (let attempt = 1; ; attempt++) {
    try {
      return stmt.all(...params) as T[]
    } catch (err) {
      const msg = String(err)
      if (msg.includes('SQLITE_BUSY') && attempt < 3) {
        const ms = 150 * attempt
        void Bun.sleep(ms)
        continue
      }
      throw err
    }
  }
}

// ─── Cuid-like id (compatível com formato Prisma) ───────────────────────────

function cuidLike(): string {
  const t = Date.now().toString(36).padStart(8, '0')
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  return `cm${t}${rand}`.slice(0, 25)
}

// ─── PlatformAlert: insert deduplicado por kind aberto + chave da meta ──────

interface AlertSpec {
  kind: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  actionHint: string
  meta: Record<string, unknown>
}

const selectOpenAlertsByKind = db.prepare(
  'SELECT id, meta FROM PlatformAlert WHERE kind = ? AND ackAt IS NULL'
)

const insertAlertStmt = db.prepare(
  'INSERT INTO PlatformAlert (id, kind, severity, message, actionHint, meta, createdAt, ackAt, ackBy) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)'
)

/** true quando já existe PlatformAlert ABERTA do kind com a mesma chave na meta. */
function hasOpenAlert(kind: string, metaKey: string, metaValue: string): boolean {
  const rows = runQuery<{ id: string; meta: string }>(selectOpenAlertsByKind, kind)
  return rows.some((row) => {
    try {
      const meta = JSON.parse(row.meta) as Record<string, unknown>
      return String(meta?.[metaKey] ?? '') === metaValue
    } catch {
      return false
    }
  })
}

/** Cria o alerta se não houver aberto equivalente; devolve true se CRIOU. */
function upsertAlert(spec: AlertSpec): boolean {
  const metaKey =
    spec.kind === 'billing.invoice_overdue'
      ? 'tenantSlug'
      : spec.kind === 'session.no_agenda'
        ? 'sessionId'
        : spec.kind === 'webhook.dead_letter'
          ? 'endpointId'
          : spec.kind === 'mail.dead_letter' || spec.kind === 'mail.backlog'
            ? 'tenantId'
          : spec.kind === 'export.orphan'
            ? 'jobId'
            : 'service'
  const metaValue = String(spec.meta[metaKey] ?? '')
  if (metaValue && hasOpenAlert(spec.kind, metaKey, metaValue)) return false
  runWrite(
    insertAlertStmt,
    cuidLike(),
    spec.kind,
    spec.severity,
    spec.message,
    spec.actionHint,
    JSON.stringify(spec.meta),
    Date.now()
  )
  return true
}

// ─── Kind: alert.scan ───────────────────────────────────────────────────────

const selectOverdueInvoices = db.prepare(`
  SELECT t.id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName, COUNT(*) AS overdueCount
  FROM Invoice i
  JOIN Tenant t ON t.id = i.tenantId
  WHERE i.status = 'open' AND i.dueAt < (strftime('%s','now') - ${INVOICE_OVERDUE_DAYS} * 86400) * 1000
  GROUP BY t.id, t.slug, t.name
`)

const selectSessionsWithoutAgenda = db.prepare(`
  SELECT s.id AS sessionId, s.number, s.year, s.scheduledAt, s.type,
         t.id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName
  FROM Session s
  JOIN Tenant t ON t.id = s.tenantId
  WHERE s.status = 'scheduled' AND s.agendaPublished = 0
    AND s.scheduledAt >= strftime('%s','now') * 1000
    AND s.scheduledAt <= (strftime('%s','now') + ${SESSION_WINDOW_HOURS} * 3600) * 1000
`)

const selectDeadDeliveries = db.prepare(`
  SELECT e.id AS endpointId, e.url,
         t.id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName,
         COUNT(d.id) AS deadCount
  FROM WebhookDelivery d
  JOIN WebhookEndpoint e ON e.id = d.endpointId
  JOIN Tenant t ON t.id = e.tenantId
  WHERE d.status = 'dead'
  GROUP BY e.id, e.url, t.id, t.slug, t.name
`)

const selectMailIssues = db.prepare(`
  SELECT d.tenantId, t.slug AS tenantSlug, t.name AS tenantName,
         SUM(CASE WHEN d.status = 'dead' THEN 1 ELSE 0 END) AS deadCount,
         SUM(CASE WHEN d.status = 'pending' AND d.createdAt <= ? THEN 1 ELSE 0 END) AS staleCount
  FROM MailDelivery d JOIN Tenant t ON t.id = d.tenantId
  WHERE d.status IN ('dead', 'pending')
  GROUP BY d.tenantId, t.slug, t.name
`)

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function runAlertScan(): { status: 'ok' | 'error'; note: string } {
  let conditions = 0
  let alertsOpen = 0

  // (a) Faturas abertas vencidas há mais de 3 dias (por tenant).
  for (const row of runQuery<{
    tenantId: string
    tenantSlug: string
    tenantName: string
    overdueCount: number
  }>(selectOverdueInvoices)) {
    conditions++
    const created = upsertAlert({
      kind: 'billing.invoice_overdue',
      severity: 'warning',
      message: `Faturas vencidas há mais de ${INVOICE_OVERDUE_DAYS} dias: "${row.tenantName}" tem ${row.overdueCount} fatura(s) em aberto.`,
      actionHint: 'Registre o pagamento ou execute o ciclo de cobrança em Console da Plataforma → Faturamento.',
      meta: { tenantSlug: row.tenantSlug, tenantId: row.tenantId, overdueCount: row.overdueCount },
    })
    if (created) log('info', 'alerta billing.invoice_overdue criado', { tenant: row.tenantSlug })
    alertsOpen++
  }

  // (b) Sessões agendadas para as próximas 48h sem pauta publicada.
  for (const row of runQuery<{
    sessionId: string
    number: number
    year: number
    scheduledAt: number
    type: string
    tenantId: string
    tenantSlug: string
    tenantName: string
  }>(selectSessionsWithoutAgenda)) {
    conditions++
    const created = upsertAlert({
      kind: 'session.no_agenda',
      severity: 'warning',
      message: `Sessão nº ${row.number}/${row.year} de "${row.tenantName}" agendada para ${fmtDay(Number(row.scheduledAt))} sem pauta publicada.`,
      actionHint: 'Publique a pauta em Sessões → Pauta da Ordem do Dia antes da sessão ocorrer.',
      meta: {
        sessionId: row.sessionId,
        tenantId: row.tenantId,
        tenantSlug: row.tenantSlug,
      },
    })
    if (created) log('info', 'alerta session.no_agenda criado', { sessionId: row.sessionId })
    alertsOpen++
  }

  // (c) Entregas de webhook em dead-letter (status 'dead' após 5 tentativas).
  for (const row of runQuery<{
    endpointId: string
    url: string
    tenantId: string
    tenantSlug: string
    tenantName: string
    deadCount: number
  }>(selectDeadDeliveries)) {
    conditions++
    const created = upsertAlert({
      kind: 'webhook.dead_letter',
      severity: 'warning',
      message: `${row.deadCount} entrega(s) de webhook em dead-letter para ${row.url} ("${row.tenantName}").`,
      actionHint: 'Reprocesse as entregas ou desative o endpoint no módulo Webhooks.',
      meta: {
        endpointId: row.endpointId,
        tenantId: row.tenantId,
        tenantSlug: row.tenantSlug,
        deadCount: row.deadCount,
      },
    })
    if (created) log('info', 'alerta webhook.dead_letter criado', { endpoint: row.endpointId })
    alertsOpen++
  }

  for (const row of runQuery<{ tenantId: string; tenantSlug: string; tenantName: string; deadCount: number; staleCount: number }>(
    selectMailIssues, Date.now() - 15 * 60_000)) {
    for (const [kind, count] of [['mail.dead_letter', row.deadCount], ['mail.backlog', row.staleCount]] as const) {
      if (!count) continue
      conditions++
      upsertAlert({ kind, severity: 'warning',
        message: kind === 'mail.dead_letter'
          ? `${count} confirmação(ões) por e-mail esgotada(s) para "${row.tenantName}".`
          : `${count} confirmação(ões) por e-mail pendente(s) há mais de 15 minutos para "${row.tenantName}".`,
        actionHint: 'Confira SMTP e worker de correio; revise e retome entregas esgotadas em Publicações → Assinaturas.',
        meta: { tenantId: row.tenantId, tenantSlug: row.tenantSlug, count },
      })
      alertsOpen++
    }
  }

  return {
    status: 'ok',
    note: `Varredura: ${conditions} condições avaliadas, ${alertsOpen} alertas criados/existentes`,
  }
}

// ─── Kind: export.watchdog ──────────────────────────────────────────────────

const selectStaleExports = db.prepare(`
  SELECT j.id, j.tenantId, t.slug AS tenantSlug, t.name AS tenantName
  FROM ExportJob j
  JOIN Tenant t ON t.id = j.tenantId
  WHERE j.status = 'running' AND j.createdAt <= (strftime('%s','now') * 1000 - ${WATCHDOG_STALE_MS})
`)

const markExportFailedStmt = db.prepare(
  "UPDATE ExportJob SET status = 'failed', error = ?, finishedAt = ? WHERE id = ?"
)

function runExportWatchdog(): { status: 'ok' | 'error'; note: string } {
  const stale = runQuery<{
    id: string
    tenantId: string
    tenantSlug: string
    tenantName: string
  }>(selectStaleExports)

  for (const job of stale) {
    const now = Date.now()
    runWrite(
      markExportFailedStmt,
      'Job órfão: execução interrompida (running há mais de 10 min) — marcado pelo watchdog do scheduler.',
      now,
      job.id
    )
    upsertAlert({
      kind: 'export.orphan',
      severity: 'warning',
      message: `Job de exportação órfão ${job.id} ("${job.tenantName}") parado em running há mais de 10 minutos.`,
      actionHint:
        'Reprocesse o job no módulo Suporte da Plataforma (card "Watchdog de exportações" → Reprocessar).',
      meta: { jobId: job.id, tenantId: job.tenantId, tenantSlug: job.tenantSlug },
    })
    log('warn', 'export job órfão marcado como failed', { jobId: job.id, tenant: job.tenantSlug })
  }

  const n = stale.length
  return {
    status: 'ok',
    note:
      n === 0
        ? '0 órfãos detectados — nenhuma exportação presa em running há mais de 10 min.'
        : n === 1
          ? '1 órfão detectado e marcado como failed (alerta export.orphan).'
          : `${n} órfãos detectados e marcados como failed (alerta export.orphan).`,
  }
}

// ─── Kind: health.check ─────────────────────────────────────────────────────

/** Ping HTTP: qualquer resposta conta como vivo; exceção = morto. */
async function serviceAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), cache: 'no-store' })
    await res.text().catch(() => '')
    return res.ok
  } catch {
    return false
  }
}

const selectOne = db.prepare('SELECT 1 AS ok')

async function runHealthCheck(): Promise<{ status: 'ok' | 'error'; note: string }> {
  const results: string[] = []
  let allOk = true

  for (const svc of SERVICES) {
    const alive = await serviceAlive(svc.url)
    results.push(`${svc.key} ${alive ? 'ok' : 'fora'}`)
    if (!alive) {
      allOk = false
      upsertAlert({
        kind: 'service.degraded',
        severity: 'warning',
        message: `Serviço ${svc.label} sem resposta no health check agendado.`,
        actionHint: 'Reinicie o serviço seguindo o runbook (docs/runbook.md).',
        meta: { service: svc.key },
      })
      log('warn', 'serviço degradado', { service: svc.key, url: svc.url })
    }
  }

  let dbOk = false
  try {
    dbOk = (runQuery<{ ok: number }>(selectOne)[0]?.ok ?? 0) === 1
  } catch {
    dbOk = false
  }
  results.push(`db ${dbOk ? 'ok' : 'fora'}`)
  if (!dbOk) allOk = false

  return { status: allOk ? 'ok' : 'error', note: results.join(' · ') }
}

// ─── Kind: tenant.health_snapshot ───────────────────────────────────────────

const selectActiveTenants = db.prepare('SELECT id, slug, name FROM Tenant WHERE active = 1')
const selectLastSnapshot = db.prepare(
  'SELECT capturedAt FROM TenantHealthSnapshot WHERE tenantId = ? ORDER BY capturedAt DESC LIMIT 1'
)
const insertSnapshotStmt = db.prepare(
  'INSERT INTO TenantHealthSnapshot (id, tenantId, score, metrics, capturedAt) VALUES (?, ?, ?, ?, ?)'
)

const sessionsStmt = db.prepare(TENANT_HEALTH_SQL.sessions30d)
const mattersStmt = db.prepare(TENANT_HEALTH_SQL.matters30d)
const loginsStmt = db.prepare(TENANT_HEALTH_SQL.logins30d)
const webhooksStmt = db.prepare(TENANT_HEALTH_SQL.activeWebhooks)

function countOf(stmt: Statement, tenantId: string): number {
  const row = stmt.get(tenantId) as { n: number | bigint } | null
  return Number(row?.n ?? 0)
}

function sameUtcDay(a: number, b: number): boolean {
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10)
}

function runTenantHealthSnapshot(): { status: 'ok' | 'error'; note: string } {
  const tenants = runQuery<{ id: string; slug: string; name: string }>(selectActiveTenants)
  const captured: number[] = []
  let skipped = 0
  const now = Date.now()

  for (const tenant of tenants) {
    const last = selectLastSnapshot.get(tenant.id) as { capturedAt: number | string } | null
    const lastMs = last ? Number(last.capturedAt) : null
    if (lastMs !== null && sameUtcDay(lastMs, now)) {
      skipped++
      continue
    }
    const metrics = {
      sessions30d: countOf(sessionsStmt, tenant.id),
      matters30d: countOf(mattersStmt, tenant.id),
      logins30d: countOf(loginsStmt, tenant.id),
      activeWebhooks: countOf(webhooksStmt, tenant.id),
    }
    const { score } = healthScoreFromMetrics(metrics)
    runWrite(
      insertSnapshotStmt,
      cuidLike(),
      tenant.id,
      score,
      JSON.stringify(metrics),
      now
    )
    captured.push(score)
    log('info', 'health snapshot capturado', { tenant: tenant.slug, score })
  }

  const capturedLabel =
    captured.length === 1
      ? `1 tenant capturado (${captured[0]})`
      : `${captured.length} tenants capturados (${captured.join('/')})`
  const note =
    skipped > 0
      ? `${capturedLabel} · ${skipped} ignorado(s) (captura de hoje já registrada)`
      : capturedLabel
  return { status: 'ok', note }
}

// ─── Executor dos kinds ─────────────────────────────────────────────────────

type KindResult = { status: 'ok' | 'error' | 'skipped'; note: string }
const staleTransferIssues = db.prepare(
  'SELECT id FROM LocalSessionTransferIssue WHERE acknowledgedAt IS NULL AND issuedAt < ? ORDER BY issuedAt LIMIT 500'
)
const deleteStaleTransferIssue = db.prepare(
  'DELETE FROM LocalSessionTransferIssue WHERE id = ? AND acknowledgedAt IS NULL AND issuedAt < ?'
)

function runTransferIssueCleanup(): KindResult {
  const cutoff = Date.now() - 30 * 86400_000
  const stale = runQuery<{ id: string }>(staleTransferIssues, cutoff)
  for (const item of stale) runWrite(deleteStaleTransferIssue, item.id, cutoff)
  return { status: 'ok', note: `${stale.length} emissão(ões) não confirmada(s) selecionada(s); limite de 500 por execução.` }
}

async function runKind(kind: string): Promise<KindResult> {
  switch (kind) {
    case 'alert.scan':
      return runAlertScan()
    case 'export.watchdog':
      return runExportWatchdog()
    case 'health.check':
      return runHealthCheck()
    case 'tenant.health_snapshot':
      return runTenantHealthSnapshot()
    case 'transfer.issue_cleanup':
      return runTransferIssueCleanup()
    case 'notice.deadline_alerts': {
      const { scanNoticeDeadlineAlerts } = await import('../../src/lib/server/notice-deadline-alerts')
      const result = await scanNoticeDeadlineAlerts()
      return { status: 'ok', note: `${result.due} prazo(s) em atenção; ${result.created} notificação(ões) nova(s).` }
    }
    default:
      throw new Error(`Kind de agendamento desconhecido: "${kind}".`)
  }
}

const KNOWN_KINDS = ['alert.scan', 'export.watchdog', 'health.check', 'tenant.health_snapshot', 'notice.deadline_alerts', 'transfer.issue_cleanup']

// ─── Tick de 30s (agenda recalcada após CADA execução agendada) ─────────────

const selectDueJobs = db.prepare(
  'SELECT id, kind, title, everySeconds, lastRunAt, nextRunAt, lastStatus, lastNote, active FROM ScheduledJob WHERE active = 1 AND nextRunAt <= ?'
)
const updateJobAfterRunStmt = db.prepare(
  'UPDATE ScheduledJob SET lastRunAt = ?, lastStatus = ?, lastNote = ?, nextRunAt = ? WHERE id = ?'
)

let ticking = false

async function tick(): Promise<void> {
  if (ticking) return // tick anterior ainda em execução — pula este ciclo
  ticking = true
  try {
    const due = runQuery<JobRow>(selectDueJobs, Date.now())
    for (const job of due) {
      const startedAt = Date.now()
      try {
        const result = await runKind(job.kind)
        const finishedAt = Date.now()
        runWrite(
          updateJobAfterRunStmt,
          finishedAt,
          result.status,
          result.note,
          finishedAt + job.everySeconds * 1000,
          job.id
        )
        log('info', 'job agendado executado', {
          kind: job.kind,
          status: result.status,
          tookMs: finishedAt - startedAt,
          nextRunIn: job.everySeconds,
        })
      } catch (err) {
        // Um job falho NÃO derruba o loop — registra o erro e adianta a agenda
        // (senão um job quebrado dispararia a cada tick).
        const raw = err instanceof Error ? err.message : String(err)
        const finishedAt = Date.now()
        runWrite(
          updateJobAfterRunStmt,
          finishedAt,
          'error',
          raw.slice(0, 300),
          finishedAt + job.everySeconds * 1000,
          job.id
        )
        log('error', 'job agendado FALHOU', { kind: job.kind, error: raw.slice(0, 300) })
      }
    }
  } catch (err) {
    log('error', 'falha no ciclo do tick', { error: String(err) })
  } finally {
    ticking = false
  }
}

// ─── Servidor HTTP (health + execução manual por kind) ──────────────────────

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const pathname = (req.url ?? '').split('?')[0] ?? '/'

  if (req.method === 'GET' && (pathname === '/health' || pathname.startsWith('/health/'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'scheduler', version: process.env.EDOCBR_BUILD_VERSION?.trim() || 'local-unversioned', port: PORT }))
    return
  }

  const runMatch = req.method === 'POST' ? pathname.match(/^\/jobs\/([^/]+)\/run$/) : null
  if (runMatch) {
    const kind = decodeURIComponent(runMatch[1])
    if (!KNOWN_KINDS.includes(kind)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `Kind desconhecido: "${kind}".` }))
      return
    }
    void (async () => {
      try {
        const result = await runKind(kind)
        log('info', 'execução manual via HTTP', { kind, status: result.status })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        log('error', 'execução manual via HTTP FALHOU', { kind, error: raw.slice(0, 300) })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', note: raw.slice(0, 300) }))
      }
    })()
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
})

// ─── Início + tick + graceful shutdown ──────────────────────────────────────

httpServer.listen(PORT, () => {
  log('info', 'scheduler iniciado', {
    port: PORT,
    dbPath: DB_PATH,
    tickIntervalMs: TICK_INTERVAL_MS,
    kinds: KNOWN_KINDS,
  })
})

const tickTimer = setInterval(() => void tick(), TICK_INTERVAL_MS)
// Primeiro ciclo quase imediato (o banco já pode ter jobs vencidos).
setTimeout(() => void tick(), 1_500)

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(tickTimer)
  log('info', 'desligando scheduler', { signal })
  try {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
      setTimeout(resolve, 3000).unref?.()
    })
  } catch (err) {
    log('error', 'erro ao encerrar servidor http', { error: String(err) })
  }
  try {
    db.close()
  } catch {
    /* banco já fechado */
  }
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

// hot-reload probe 23:18:06
