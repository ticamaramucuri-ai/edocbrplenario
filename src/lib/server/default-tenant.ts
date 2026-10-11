import { db } from '@/lib/db'
import { demoModeEnabled } from './demo-mode'

/** Tenant de entrada; perfil demo continua na Câmara fictícia. */
export async function defaultTenant() {
  const preferredSlug = process.env.DEFAULT_TENANT_SLUG?.trim()
    || (demoModeEnabled() ? 'camara-vila-nova' : 'camara-mucuri-ba')
  const preferred = await db.tenant.findUnique({ where: { slug: preferredSlug } })
  if (preferred?.active) return preferred
  return db.tenant.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } })
}
