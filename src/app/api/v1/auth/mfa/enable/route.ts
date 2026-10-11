/**
 * POST /api/v1/auth/mfa/enable — confirma o segredo pendente (Onda 5 / F22).
 *
 * Autenticado. Body { totp }: valida o código contra `User.mfaSecret`
 * pendente com drift ±1 (RFC 6238). Código válido → `mfaEnabled=true` +
 * auditoria `user.mfa_enabled` (summary SEM o segredo — dado sensível).
 * Código inválido → 401 INVALID_CREDENTIALS. Sem segredo pendente → 422.
 * A partir daqui o login por senha exige o segundo fator (401 MFA_REQUIRED).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, invalidCredentials } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { writeAudit } from '@/lib/server/audit'
import { verifyTotp } from '@/lib/server/totp'
import type { Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const enableSchema = z.object({
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Código TOTP deve ter 6 dígitos.'),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  const body = enableSchema.parse(await req.json())

  const user = await db.user.findUnique({ where: { id: actor.id } })
  if (!user || !user.active) {
    throw new DomainError('NOT_FOUND', 404, 'Não encontrado', 'Usuário autenticado não encontrado.')
  }
  if (user.mfaEnabled) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'MFA já habilitado',
      'O MFA já está habilitado para esta conta. Para trocar o segredo, desabilite-o antes.'
    )
  }
  if (!user.mfaSecret) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Sem segredo pendente',
      'Nenhum segredo TOTP pendente. Execute "Configurar MFA" antes de confirmar o código.'
    )
  }
  if (!verifyTotp(user.mfaSecret, body.totp)) {
    throw invalidCredentials('Código TOTP inválido. Confira o gerador e tente novamente.')
  }

  await db.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true },
  })

  // Auditoria SEM o segredo (dado sensível — nunca vaza para o trilho).
  if (user.tenantId) {
    await withTransaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: user.tenantId as string,
        actor: { name: user.name, role: user.role as Role },
        action: 'user.mfa_enabled',
        aggregateType: 'user',
        aggregateId: user.id,
        summary: `MFA (TOTP RFC 6238) habilitado para ${user.email} — login passa a exigir segundo fator.`,
        correlationId,
      })
    })
  }

  return NextResponse.json({ ok: true })
})
