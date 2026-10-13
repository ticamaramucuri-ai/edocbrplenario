/** GET /api/v1/public/live?tenant=slug — visão pública da sessão selecionada. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { defaultTenant } from '@/lib/server/default-tenant'
import { buildPublicLiveView } from '@/lib/server/public-live'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const slug = req.nextUrl.searchParams.get('tenant')
  const tenant = slug
    ? await db.tenant.findUnique({ where: { slug } })
    : await defaultTenant()
  if (!tenant?.active) throw notFound('Tenant não encontrado (use ?tenant=slug).')
  return Response.json(await buildPublicLiveView(db, tenant))
})
