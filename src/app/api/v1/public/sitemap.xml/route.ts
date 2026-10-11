/**
 * GET /api/v1/public/sitemap.xml?tenant= — sitemap XML simples com as sessões
 * e matérias do tenant (loc fictício /{tipo}/{numero}/{ano}).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolvePublicTenant } from '@/lib/server/public-tenant'

export const dynamic = 'force-dynamic'

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const tenant = await resolvePublicTenant(req.nextUrl.searchParams.get('tenant'))
  const base = 'https://portal.legissaas.example'

  const [sessions, matters] = await Promise.all([
    db.session.findMany({
      where: { tenantId: tenant.id, status: { not: 'draft' } },
      orderBy: { scheduledAt: 'desc' },
      take: 500,
    }),
    db.legislativeMatter.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ type: 'asc' }, { number: 'desc' }],
      take: 1000,
    }),
  ])

  const urls: string[] = [
    `  <url><loc>${xmlEscape(base)}/</loc><changefreq>daily</changefreq></url>`,
    ...sessions.map(
      (s) =>
        `  <url><loc>${xmlEscape(`${base}/sessoes/${s.type}/${s.number}/${s.year}`)}</loc><lastmod>${s.updatedAt.toISOString()}</lastmod></url>`
    ),
    ...matters.map(
      (m) =>
        `  <url><loc>${xmlEscape(`${base}/materias/${m.type}/${m.number}/${m.year}`)}</loc><lastmod>${m.updatedAt.toISOString()}</lastmod></url>`
    ),
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
})
