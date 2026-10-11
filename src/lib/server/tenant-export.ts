/**
 * Fase 20 — exportação integral do tenant como JOB ASSÍNCRONO.
 *
 * `buildTenantExport` concentra a serialização integral (shape EXATO do
 * export síncrono da Fase 16, sem segredos: `passwordHash` de usuários,
 * `secret` de webhooks e VALORES de votos secretos — participação mantida,
 * valor jamais). Usada por:
 *
 *  - POST /platform/tenants/:id/export → cria ExportJob e dispara
 *    `processExportJob` (fire-and-forget): etapas REAIS de contagem por grupo
 *    de tabelas com progresso monotônico 0→100 + serialização final de
 *    validação; falha → status=failed + error.
 *  - GET /platform/exports/:id/download → regeneração DETERMINÍSTICA no
 *    momento do download (snapshot consistente — documentado no cabeçalho da
 *    resposta): o job valida que a exportação é construível e o download
 *    entrega o estado corrente do tenant.
 */
import type { ExportJob } from '@prisma/client'
import { db } from '@/lib/db'
import { notFound } from '@/lib/server/errors'
import type { ExportJobStatus, ExportJobView } from '@/lib/contracts'

export function toExportJobView(job: ExportJob): ExportJobView {
  return {
    id: job.id,
    status: job.status as ExportJobStatus,
    progress: job.progress,
    error: job.error ?? null,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  }
}

export type TenantExportPayload = {
  exportedAt: string
  tenant: { id: string; slug: string; name: string }
  counts: Record<string, number>
  data: Record<string, unknown>
}

/** Converte para JSON puro (Date → ISO string) de forma determinística. */
function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parseSettings(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Exportação integral do tenant — MESMO shape do export síncrono original
 * (Fase 16): { exportedAt, tenant, counts, data }. Nunca inclui segredos.
 */
export async function buildTenantExport(tenantId: string): Promise<TenantExportPayload> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw notFound('Tenant não encontrado.')

  // Exportação integral: TODAS as entidades do tenant (schema Prisma).
  const [
    users,
    legislatures,
    parliamentarians,
    parties,
    blocs,
    boardPositions,
    committees,
    committeeMembers,
    committeeMeetings,
    mandates,
    leaves,
    matterTypeConfigs,
    matters,
    protocolEntries,
    legislativeTasks,
    sessions,
    publications,
    hearings,
    templates,
    notifications,
    webhookEndpoints,
    invoices,
    subscription,
    auditEvents,
  ] = await Promise.all([
    db.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    db.legislature.findMany({ where: { tenantId }, orderBy: { number: 'asc' } }),
    db.parliamentarian.findMany({ where: { tenantId }, orderBy: { order: 'asc' } }),
    db.party.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    db.bloc.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    db.boardPosition.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    db.committee.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    db.committeeMember.findMany({ where: { committee: { tenantId } }, orderBy: { createdAt: 'asc' } }),
    db.committeeMeeting.findMany({ where: { committee: { tenantId } }, orderBy: { scheduledAt: 'asc' } }),
    db.mandate.findMany({ where: { tenantId }, orderBy: { startDate: 'asc' } }),
    db.leave.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    db.matterTypeConfig.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
    db.legislativeMatter.findMany({
      where: { tenantId },
      orderBy: [{ year: 'asc' }, { number: 'asc' }],
      include: {
        proceedings: { orderBy: { seq: 'asc' } },
        versions: { orderBy: { version: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    }),
    db.protocolEntry.findMany({ where: { tenantId }, orderBy: [{ year: 'asc' }, { number: 'asc' }] }),
    db.legislativeTask.findMany({ where: { tenantId }, orderBy: { dueAt: 'asc' } }),
    db.session.findMany({
      where: { tenantId },
      orderBy: [{ year: 'asc' }, { number: 'asc' }],
      include: {
        agendaItems: { orderBy: { order: 'asc' } },
        attendanceEvents: { orderBy: { createdAt: 'asc' } },
        votings: {
          orderBy: { createdAt: 'asc' },
          include: { votes: { orderBy: { receivedAt: 'asc' } } },
        },
        speeches: { orderBy: { createdAt: 'asc' } },
      },
    }),
    db.publication.findMany({ where: { tenantId }, orderBy: [{ year: 'asc' }, { number: 'asc' }] }),
    db.publicHearing.findMany({
      where: { tenantId },
      orderBy: { scheduledAt: 'asc' },
      include: { questions: { orderBy: { createdAt: 'asc' } } },
    }),
    db.documentTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { version: 'asc' } } },
    }),
    db.notification.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    db.webhookEndpoint.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    db.invoice.findMany({ where: { tenantId }, orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { number: 'asc' }] }),
    db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    db.auditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        action: true,
        actorName: true,
        actorRole: true,
        aggregateType: true,
        aggregateId: true,
        summary: true,
        justification: true,
        prevHash: true,
        chainHash: true,
        createdAt: true,
      },
    }),
  ])

  // ─── Serialização + sigilo ────────────────────────────────────────────────
  const data = toJsonSafe({
    tenant: { ...tenant, settings: parseSettings(tenant.settings) },
    users: users.map(({ passwordHash: _passwordHash, ...u }) => u),
    legislatures,
    parliamentarians,
    parties,
    blocs,
    boardPositions,
    committees,
    committeeMembers,
    committeeMeetings,
    mandates,
    leaves,
    matterTypeConfigs,
    legislativeMatters: matters,
    protocolEntries,
    legislativeTasks,
    sessions: sessions.map((s) => ({
      ...s,
      votings: s.votings.map((v) => ({
        ...v,
        // Voto secreto: participação mantida, valor JAMAIS exportado.
        votes: v.votes.map((vote) => ({ ...vote, value: v.mode === 'secreto' ? null : vote.value })),
      })),
    })),
    publications,
    publicHearings: hearings,
    documentTemplates: templates,
    notifications,
    webhookEndpoints: webhookEndpoints.map(({ secret: _secret, ...e }) => e),
    invoices,
    subscription: subscription
      ? {
          id: subscription.id,
          planId: subscription.planId,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          createdAt: subscription.createdAt,
          updatedAt: subscription.updatedAt,
          plan: {
            id: subscription.plan.id,
            name: subscription.plan.name,
            priceCents: subscription.plan.priceCents,
          },
        }
      : null,
    auditEvents, // a cadeia completa (prevHash → chainHash, ordem cronológica)
  })

  const sum = (arr: Array<Record<string, unknown>>, key: string) =>
    arr.reduce((acc, item) => {
      const nested = item[key]
      return acc + (Array.isArray(nested) ? nested.length : 0)
    }, 0)

  const votesTotal = sessions.reduce(
    (acc, s) => acc + s.votings.reduce((a, v) => a + v.votes.length, 0),
    0
  )

  const counts: Record<string, number> = {
    users: users.length,
    legislatures: legislatures.length,
    parliamentarians: parliamentarians.length,
    parties: parties.length,
    blocs: blocs.length,
    boardPositions: boardPositions.length,
    committees: committees.length,
    committeeMembers: committeeMembers.length,
    committeeMeetings: committeeMeetings.length,
    mandates: mandates.length,
    leaves: leaves.length,
    matterTypeConfigs: matterTypeConfigs.length,
    legislativeMatters: matters.length,
    proceedings: sum(matters as unknown as Array<Record<string, unknown>>, 'proceedings'),
    matterVersions: sum(matters as unknown as Array<Record<string, unknown>>, 'versions'),
    matterAttachments: sum(matters as unknown as Array<Record<string, unknown>>, 'attachments'),
    protocolEntries: protocolEntries.length,
    legislativeTasks: legislativeTasks.length,
    sessions: sessions.length,
    agendaItems: sum(sessions as unknown as Array<Record<string, unknown>>, 'agendaItems'),
    attendanceEvents: sum(sessions as unknown as Array<Record<string, unknown>>, 'attendanceEvents'),
    votings: sum(sessions as unknown as Array<Record<string, unknown>>, 'votings'),
    votes: votesTotal,
    speeches: sum(sessions as unknown as Array<Record<string, unknown>>, 'speeches'),
    publications: publications.length,
    publicHearings: hearings.length,
    hearingQuestions: sum(hearings as unknown as Array<Record<string, unknown>>, 'questions'),
    documentTemplates: templates.length,
    documentTemplateVersions: sum(templates as unknown as Array<Record<string, unknown>>, 'versions'),
    notifications: notifications.length,
    webhookEndpoints: webhookEndpoints.length,
    invoices: invoices.length,
    auditEvents: auditEvents.length,
  }

  return {
    exportedAt: new Date().toISOString(),
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    counts,
    data,
  }
}
