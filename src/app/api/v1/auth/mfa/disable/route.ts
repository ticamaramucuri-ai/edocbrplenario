/**
 * POST /api/v1/auth/mfa/disable — desabilita o MFA (Onda 5 / F22).
 *
 * Autenticado. Body { password, totp }: exige a SENHA atual (scrypt) e um
 * código TOTP válido (drift ±1) — dois fatores para REMOVER o segundo
 * fator. Sucesso → `mfaEnabled=false` E `mfaSecret=null` (o segredo deixa
 * de existir no banco) + auditoria `user.mfa_disabled`. Erros sempre
 * 401 INVALID_CREDENTIALS genérico; MFA não habilitado → 422.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, invalidCredentials } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { writeAudit } from '@/lib/server/audit'
import { verifyTotp } from '@/lib/server/totp'
import { verifyPassword } from '@/lib/server/session'
import type { Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const disableSchema = z.object({
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres.'),
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Código TOTP deve ter 6 dígitos.'),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  const body = disableSchema.parse(await req.json())

  const user = await db.user.findUnique({ where: { id: actor.id } })
  if (!user || !user.active) {
    throw new DomainError('NOT_FOUND', 404, 'Não encontrado', 'Usuário autenticado não encontrado.')
  }
  if (!user.mfaEnabled || !user.mfaSecret) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'MFA desabilitado',
      'O MFA não está habilitado para esta conta.'
    )
  }
  if (!user.passwordHash || !verifyPassword(body.password, user.passwordHash)) {
    throw invalidCredentials()
  }
  if (!verifyTotp(user.mfaSecret, body.totp)) {
    throw invalidCredentials('Código TOTP inválido. Confira o gerador e tente novamente.')
  }

  // O segredo deixa de EXISTIR (null) — não apenas desabilitado.
  await db.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null },
  })

  if (user.tenantId) {
    await withTransaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: user.tenantId as string,
        actor: { name: user.name, role: user.role as Role },
        action: 'user.mfa_disabled',
        aggregateType: 'user',
        aggregateId: user.id,
        summary: `MFA desabilitado para ${user.email} (senha + código confirmados; segredo TOTP removido do banco).`,
        correlationId,
      })
    })
  }

  return NextResponse.json({ ok: true })
})
