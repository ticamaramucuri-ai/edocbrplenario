/**
 * POST /api/v1/auth/login — autenticação real (Fase 9).
 * Sem resolveActor: valida e-mail/senha (scrypt), cria AuthSession (token em
 * cookie httpOnly `legis_session`, 7 dias) e devolve o ator. Falhas sempre
 * respondem INVALID_CREDENTIALS genérico (sem enumeração de e-mails);
 * auditoria `auth.login` apenas em sucesso com tenant.
 *
 * Onda 5 / Fase 22: senha válida com MFA habilitado → 401 MFA_REQUIRED
 * (SEM sessão/cookie) — o frontend muda para o passo 2 (código TOTP) e
 * completa via POST /api/v1/auth/login/mfa.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, forbiddenTenantInactive, invalidCredentials, mfaRequired } from '@/lib/server/errors'
import { writeAudit } from '@/lib/server/audit'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession, verifyPassword } from '@/lib/server/session'
import type { Role } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const PLATFORM_ROLES: Role[] = ['platform_owner', 'platform_support']

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres.'),
})

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const body = loginSchema.parse(await req.json())
  const email = body.email.toLowerCase()

  // E-mail inexistente, usuário sem senha (ator demo), inativo ou senha errada
  // → mesma resposta genérica (não vaza qual campo falhou).
  const user = await db.user.findUnique({
    where: { email },
    include: { parliamentarian: true, tenant: true },
  })
  if (!user || !user.passwordHash || !user.active) throw invalidCredentials()
  if (!verifyPassword(body.password, user.passwordHash)) throw invalidCredentials()

  // Tenant desativado bloqueia papéis com escopo de tenant (Fase 9).
  const isPlatform = PLATFORM_ROLES.includes(user.role as Role)
  if (!isPlatform && user.tenantId && user.tenant && !user.tenant.active) {
    throw forbiddenTenantInactive(
      'Este tenant está desativado. Contate o operador da plataforma para reativá-lo.'
    )
  }

  // F22 — MFA ativo: a senha correta NÃO basta. Sem sessão, sem cookie —
  // o cliente lê o code MFA_REQUIRED do problem details e pede o TOTP.
  if (user.mfaEnabled) throw mfaRequired()

  const token = await createSession(user.id, req.headers.get('user-agent'), clientIp(req))

  // Auditoria apenas de login bem-sucedido com tenant (falhas de senha NÃO
  // são auditadas — evita ruído no trilho e enumeração de e-mails).
  if (user.tenantId) {
    await withTransaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: user.tenantId as string,
        actor: { name: user.name, role: user.role as Role },
        action: 'auth.login',
        aggregateType: 'user',
        aggregateId: user.id,
        summary: `Login por senha de ${user.name}.`,
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
