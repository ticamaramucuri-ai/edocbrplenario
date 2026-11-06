/**
 * POST /api/v1/auth/login/mfa — login com segundo fator (Onda 5 / F22).
 *
 * Público. Body { email, password, totp }: senha válida + MFA habilitado +
 * código TOTP válido (drift ±1) → cria AuthSession IGUAL ao login normal
 * (cookie httpOnly `legis_session`, 7 dias) e devolve `{ actor }` no MESMO
 * shape da rota /auth/login. Toda falha responde 401 INVALID_CREDENTIALS
 * genérico (não vaza qual fator falhou — mesma política anti-enumeração).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, forbiddenTenantInactive, invalidCredentials } from '@/lib/server/errors'
import { writeAudit } from '@/lib/server/audit'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession, verifyPassword } from '@/lib/server/session'
import { verifyTotp } from '@/lib/server/totp'
import type { Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const PLATFORM_ROLES: Role[] = ['platform_owner', 'platform_support', 'platform_monitor']

const loginMfaSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres.'),
  totp: z.string().trim().regex(/^\d{6}$/, 'Código TOTP deve ter 6 dígitos.'),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const body = loginMfaSchema.parse(await req.json())
  const email = body.email.toLowerCase()

  const user = await db.user.findUnique({
    where: { email },
    include: { parliamentarian: true, tenant: true },
  })
  if (!user || !user.passwordHash || !user.active) throw invalidCredentials()
  if (!verifyPassword(body.password, user.passwordHash)) throw invalidCredentials()
  if (!user.mfaEnabled || !user.mfaSecret || !verifyTotp(user.mfaSecret, body.totp)) {
    throw invalidCredentials()
  }

  // Tenant desativado bloqueia papéis com escopo de tenant (mesma regra do login).
  const isPlatform = PLATFORM_ROLES.includes(user.role as Role)
  if (!isPlatform && user.tenantId && user.tenant && !user.tenant.active) {
    throw forbiddenTenantInactive(
      'Este tenant está desativado. Contate o operador da plataforma para reativá-lo.'
    )
  }

  const token = await createSession(user.id, req.headers.get('user-agent'), clientIp(req))

  if (user.tenantId) {
    await withTransaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: user.tenantId as string,
        actor: { name: user.name, role: user.role as Role },
        action: 'auth.login',
        aggregateType: 'user',
        aggregateId: user.id,
        summary: `Login por senha + segundo fator (TOTP) de ${user.name}.`,
        correlationId,
        ip: clientIp(req),
      })
    })
  }

  const res = NextResponse.json({
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      jobTitle: user.jobTitle ?? null,
      tenantId: user.tenantId ?? null,
      parliamentarianId: user.parliamentarianId ?? null,
      ...(user.tenant ? { tenantName: user.tenant.name } : {}),
    },
  })
  res.cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
})
