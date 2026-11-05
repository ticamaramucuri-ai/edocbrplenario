/**
 * PATCH /api/v1/tenants/:id — white-label (RBAC tenant.update):
 * name, city, uf, primaryColor, accentColor e settings (merge com atuais).
 * Auditoria `tenant.updated` com before/after. Apenas persiste (sem outbox).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadTenant } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { toTenantView } from '@/lib/server/serializers'
import { tenantSettings } from '@/lib/server/domain'
import type { Tenant } from '@prisma/client'

export const dynamic = 'force-dynamic'

const settingsSchema = z
  .object({
    quorumMinimum: z.number().int().min(1).max(100).optional(),
    allowVoteChange: z.boolean().optional(),
    speechDefaultSeconds: z.number().int().min(30).max(3600).optional(),
    soundAlerts: z.boolean().optional(),
    hidePartialByDefault: z.boolean().optional(),
    enabledSessionTypes: z.array(z.enum(['ordinaria', 'extraordinaria', 'solene', 'especial'])).min(1).max(4).refine((v) => new Set(v).size === v.length).optional(),
    requireSecretaryForPublication: z.boolean().optional(),
    minimumAgendaMatters: z.number().int().min(0).max(100).optional(),
    minimumNoticeHours: z.number().int().min(0).max(720).optional(),
    minimumAmendmentHours: z.number().int().min(0).max(720).optional(),
    urgentNoticeExceptionTypes: z.array(z.enum(['ordinaria', 'extraordinaria', 'solene', 'especial'])).max(4).refine((v) => new Set(v).size === v.length).optional(),
    noticeAlertLeadHours: z.number().int().min(1).max(168).optional(),
    noticeRecipientPolicy: z.enum(['active', 'mandate_and_leave']).optional(),
    deliberativeRosterPolicy: z.enum(['active', 'mandate_and_leave']).optional(),
    votingImpedimentPolicy: z.enum(['disabled', 'retain_base', 'reduce_base']).optional(),
    replayVisibilityDays: z.number().int().min(1).max(3650).nullable().optional(),
    votingPoliciesByMatterType: z.partialRecord(z.enum(['projeto_de_lei', 'decreto_legislativo', 'requerimento', 'indicacao', 'mocao', 'emenda']),
      z.object({ rule: z.enum(['maioria_simples', 'maioria_absoluta', 'unanimidade']), quorumMinimum: z.number().int().min(1).max(100) }).strict()).optional(),
  })
  .strict()

const contactSchema = z.object({
  address: z.string().trim().max(250).nullable(),
  postalCode: z.string().trim().regex(/^\d{2}\.?\d{3}-?\d{3}$/, 'CEP inválido.').nullable(),
  generalPhone: z.string().trim().max(35).nullable(),
  alternatePhone: z.string().trim().max(35).nullable(),
  ombudsmanPhone: z.string().trim().max(35).nullable(),
  generalEmail: z.string().email().max(254).nullable(),
  protocolEmail: z.string().email().max(254).nullable(),
  ombudsmanEmail: z.string().email().max(254).nullable(),
  websiteUrl: z.string().url().startsWith('https://', 'Use um endereço HTTPS.').max(500).nullable(),
  serviceHours: z.string().trim().max(180).nullable(),
  sessionHours: z.string().trim().max(180).nullable(),
}).partial().strict()

function contactSnapshot(tenant: Tenant) {
  return {
    address: tenant.contactAddress, postalCode: tenant.contactPostalCode,
    generalPhone: tenant.contactGeneralPhone, alternatePhone: tenant.contactAlternatePhone,
    ombudsmanPhone: tenant.contactOmbudsmanPhone, generalEmail: tenant.contactGeneralEmail,
    protocolEmail: tenant.contactProtocolEmail, ombudsmanEmail: tenant.contactOmbudsmanEmail,
    websiteUrl: tenant.contactWebsiteUrl, serviceHours: tenant.contactServiceHours,
    sessionHours: tenant.contactSessionHours,
  }
}

const bodySchema = z
  .object({
    name: z.string().min(3).max(140).optional(),
    city: z.string().min(2).max(80).optional(),
    uf: z.string().length(2).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor hex (#rrggbb).').optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor hex (#rrggbb).').optional(),
    contact: contactSchema.optional(),
    settings: settingsSchema.optional(),
  })
  .strict()

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'tenant.update')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const current = await loadTenant(actor, id)
  const activeCount = await db.parliamentarian.count({
    where: { tenantId: current.id, active: true },
  })
  const currentSettings = tenantSettings(current, activeCount)

  const updated = await withTransaction(async (tx) => {
    const mergedSettings = { ...currentSettings, ...(body.settings ?? {}) }
    const tenant = await tx.tenant.update({
      where: { id: current.id },
      data: {
        name: body.name ?? undefined,
        city: body.city ?? undefined,
        uf: body.uf ? body.uf.toUpperCase() : undefined,
        primaryColor: body.primaryColor ?? undefined,
        accentColor: body.accentColor ?? undefined,
        contactAddress: body.contact?.address,
        contactPostalCode: body.contact?.postalCode,
        contactGeneralPhone: body.contact?.generalPhone,
        contactAlternatePhone: body.contact?.alternatePhone,
        contactOmbudsmanPhone: body.contact?.ombudsmanPhone,
        contactGeneralEmail: body.contact?.generalEmail,
        contactProtocolEmail: body.contact?.protocolEmail,
        contactOmbudsmanEmail: body.contact?.ombudsmanEmail,
        contactWebsiteUrl: body.contact?.websiteUrl,
        contactServiceHours: body.contact?.serviceHours,
        contactSessionHours: body.contact?.sessionHours,
        settings: body.settings ? JSON.stringify(mergedSettings) : undefined,
      },
    })

    await writeAudit(tx, {
      tenantId: current.id,
      actor,
      action: 'tenant.updated',
      aggregateType: 'tenant',
      aggregateId: current.id,
      summary: 'Configurações de white-label atualizadas.',
      before: {
        name: current.name,
        city: current.city,
        uf: current.uf,
        primaryColor: current.primaryColor,
        accentColor: current.accentColor,
        contact: contactSnapshot(current),
        settings: currentSettings,
      },
      after: {
        name: tenant.name,
        city: tenant.city,
        uf: tenant.uf,
        primaryColor: tenant.primaryColor,
        accentColor: tenant.accentColor,
        contact: contactSnapshot(tenant),
        settings: mergedSettings,
      },
      correlationId,
      ip: clientIp(req),
    })

    return tenant
  })

  const updatedCount = await db.parliamentarian.count({
    where: { tenantId: updated.id, active: true },
  })
  return Response.json({ tenant: toTenantView(updated, updatedCount) })
})
