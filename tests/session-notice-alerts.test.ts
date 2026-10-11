import { afterAll, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import { scanNoticeDeadlineAlerts } from '@/lib/server/notice-deadline-alerts'

afterAll(async () => { await db.$disconnect() })

test('avisos são persistidos uma vez por prazo e papel, com escopo da Câmara', async () => {
  const now = new Date()
  const tenant = await db.tenant.create({ data: {
    slug: 'alertas-prazo', name: 'Câmara dos Alertas', city: 'Cidade', uf: 'BA',
    settings: JSON.stringify({ minimumNoticeHours: 24, minimumAmendmentHours: 8, noticeAlertLeadHours: 8 }),
  } })
  const other = await db.tenant.create({ data: { slug: 'alertas-outra', name: 'Outra Câmara', city: 'Cidade', uf: 'BA',
    settings: JSON.stringify({ minimumNoticeHours: 24, noticeAlertLeadHours: 1 }) } })
  const draft = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026, type: 'ordinaria',
    scheduledAt: new Date(now.getTime() + 30 * 60 * 60 * 1000) } })
  await db.session.create({ data: { tenantId: tenant.id, number: 2, year: 2026, type: 'ordinaria',
    scheduledAt: new Date(now.getTime() + 5 * 60 * 60 * 1000), status: 'scheduled', agendaPublished: true } })
  await db.session.create({ data: { tenantId: other.id, number: 1, year: 2026, type: 'ordinaria',
    scheduledAt: new Date(now.getTime() + 30 * 60 * 60 * 1000) } })

  await scanNoticeDeadlineAlerts(now)
  const alerts = await db.notification.findMany({ where: { tenantId: tenant.id, dedupeKey: { not: null } } })
  expect(alerts).toHaveLength(4)
  expect(new Set(alerts.map((row) => row.targetRole))).toEqual(new Set(['tenant_admin', 'session_operator']))
  expect(alerts.filter((row) => row.title.startsWith('Prazo próximo'))).toHaveLength(2)
  expect(alerts.filter((row) => row.title.startsWith('Prazo vencido'))).toHaveLength(2)
  expect(await db.notification.count({ where: { tenantId: other.id, dedupeKey: { not: null } } })).toBe(0)
  expect(await db.outboxEvent.count({ where: { tenantId: tenant.id, eventType: 'notification.new' } })).toBe(4)
  const second = await scanNoticeDeadlineAlerts(now)
  expect(second.created).toBe(0)
  expect(await db.notification.count({ where: { tenantId: tenant.id, dedupeKey: { not: null } } })).toBe(4)

  // Remarcar cria novo prazo; não altera o aviso histórico anterior.
  await db.session.update({ where: { id: draft.id }, data: { scheduledAt: new Date(now.getTime() + 29 * 60 * 60 * 1000) } })
  await scanNoticeDeadlineAlerts(now)
  expect(await db.notification.count({ where: { tenantId: tenant.id, dedupeKey: { not: null } } })).toBe(6)
})
