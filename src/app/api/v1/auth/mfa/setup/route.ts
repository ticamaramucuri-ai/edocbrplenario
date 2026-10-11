/**
 * POST /api/v1/auth/mfa/setup — gera segredo TOTP pendente (Onda 5 / F22).
 *
 * Autenticado (resolveActor: sessão OU modo demo). Só persiste o segredo
 * enquanto `mfaEnabled=false` (habilitado → 422 — trocar segredo exige
 * desabilitar antes). Responde MfaSetupView { secret, otpauthUrl } — o
 * segredo é exibido UMA vez nesta resposta e NUNCA mais depois de
 * habilitado. Sem auditoria: o payload carrega dado sensível (o segredo).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { generateTotpSecret, otpauthUrl } from '@/lib/server/totp'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const user = await db.user.findUnique({ where: { id: actor.id } })
  if (!user || !user.active) {
    throw new DomainError('NOT_FOUND', 404, 'Não encontrado', 'Usuário autenticado não encontrado.')
  }
  if (user.mfaEnabled) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'MFA já habilitado',
      'Desabilite o MFA antes de gerar novo segredo (a troca exige senha e código válidos).'
    )
  }

  const secret = generateTotpSecret()
  await db.user.update({
    where: { id: user.id },
    data: { mfaSecret: secret },
  })

  return NextResponse.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) })
})
