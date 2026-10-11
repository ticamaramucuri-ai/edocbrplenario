/**
 * Resolução de tenant para endpoints PÚBLICOS (/api/v1/public/*):
 * `?tenant=slug` (default: primeiro tenant ativo — camara-vila-nova).
 * Sem autenticação; NUNCA expõe dados internos (escopo definido por cada rota).
 */
import { db } from '@/lib/db'
import { notFound } from './errors'
import type { Tenant } from '@prisma/client'
import { defaultTenant } from './default-tenant'

export async function resolvePublicTenant(slug: string | null): Promise<Tenant> {
  const tenant = slug
    ? await db.tenant.findUnique({ where: { slug } })
    : await defaultTenant()
  if (!tenant || !tenant.active) {
    throw notFound('Tenant não encontrado (use ?tenant=slug).')
  }
  return tenant
}
