/**
 * POST /api/v1/webhooks/echo — endpoint PÚBLICO de eco para demonstração de
 * entrega local (sem internet): sempre 200 {ok:true, receivedAt}.
 * Usado como URL-alvo de webhooks no ambiente sandbox (ex.: módulo Webhooks).
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const body = await req.text().catch(() => '')
  return NextResponse.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    bytes: body.length,
    echo: {
      signature: req.headers.get('x-legis-signature') ?? null,
      timestamp: req.headers.get('x-legis-timestamp') ?? null,
      event: req.headers.get('x-legis-event') ?? null,
    },
  })
}
