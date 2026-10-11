/**
 * POST /api/v1/auth/logout — revoga a sessão do cookie `legis_session`
 * (quando existir) e limpa o cookie. Sem exigir ator: logout é sempre ok.
 */
import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/server/errors'
import { SESSION_COOKIE, getSessionToken, revokeSession } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const token = getSessionToken(req)
  if (token) await revokeSession(token)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
  })
  return res
})
