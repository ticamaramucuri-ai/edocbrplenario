/**
 * Sessões de autenticação real (Fase 9) — senha scrypt + cookie httpOnly.
 *
 * Modelo: token aleatório de 32 bytes entregue ao cliente no cookie
 * `legis_session`; apenas o SHA-256 do token é persistido (AuthSession).
 * Coexiste com o modo demo x-actor-id (ADR-005): a resolução do ator tenta
 * PRIMEIRO a sessão, depois o header demo.
 *
 * Fase 20 (impersonação auditada): a AuthSession pode carregar um
 * `impersonationId` (SupportImpersonation). Enquanto a impersonação está
 * ATIVA (endedAt null E expiresAt > now), o usuário EFETIVO da sessão é o
 * ALVO — `resolveSessionToken` devolve o alvo, de modo que `resolveActor`
 * (actor.ts) e todas as rotas enxergam o ator-alvo de forma TRANSPARENTE,
 * sem mudanças. A expiração é LAZY: ao ler uma sessão cujo prazo venceu (ou
 * cujo alvo foi desativado), a impersonação é encerrada na hora e a sessão
 * volta a enxergar o próprio suporte. O logout (revokeSession) também
 * encerra a impersonação (hook determinístico na revogação).
 *
 * Onda 5 / Fase 22: a resolução de sessão válida atualiza `lastUsedAt`
 * best-effort (throttle de 5 min) — combustível da lista "Sessões ativas".
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import type { AuthSession, Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'legis_session'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 dias

/** F22 — throttle do lastUsedAt: no máximo um write a cada 5 minutos. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000

/** User com parlamentar incluído (formato usado na resolução de sessão). */
export type SessionUser = Prisma.UserGetPayload<{ include: { parliamentarian: true } }>

/** Impersonação ativa carregada por uma sessão (suporte → alvo). */
export type ActiveImpersonation = {
  impersonationId: string
  supportName: string
  targetName: string
  reason: string
  expiresAt: Date
  /** Usuário-alvo (ator EFETIVO da sessão enquanto a impersonação durar). */
  targetUser: SessionUser
}

/** Sessão resolvida com o contexto completo de impersonação (Fase 20). */
export type SessionContext = {
  session: AuthSession
  /** Usuário EFETIVO: o ALVO durante impersonação ativa; senão o proprietário. */
  user: SessionUser
  /** Usuário real proprietário da sessão (o suporte durante impersonação). */
  sessionUser: SessionUser
  impersonation: ActiveImpersonation | null
}

// ─── Senha (scrypt) ──────────────────────────────────────────────────────────

/** Hash no formato `scrypt$<saltHex>$<hashHex>` (salt 16 bytes, hash 64 bytes). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** Comparação em tempo constante (timingSafeEqual); formatos inválidos → false. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    if (salt.length === 0 || expected.length === 0) return false
    const actual = scryptSync(password, salt, expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ─── Sessões (AuthSession) ───────────────────────────────────────────────────

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Cria uma AuthSession com expiração de 7 dias. O token puro NUNCA é
 * persistido (apenas o SHA-256) — devolve o token para o cookie httpOnly.
 */
export async function createSession(
  userId: string,
  userAgent?: string | null,
  ip?: string | null
): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.authSession.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      userAgent: userAgent?.slice(0, 300) ?? null,
      ip: ip ?? null,
    },
  })
  return token
}

/**
 * Busca a sessão pelo token: precisa existir, não estar revogada e não estar
 * expirada. Se o usuário estiver inativo → revoga TODAS as sessões dele e
 * devolve null.
 *
 * Fase 20: durante impersonação ATIVA o `user` devolvido é o USUÁRIO-ALVO
 * (com parlamentar incluído) — transparência total para resolveActor/rotas.
 */
export async function resolveSessionToken(
  token: string
): Promise<{ session: AuthSession; user: SessionUser } | null> {
  const ctx = await resolveSessionContext(token)
  if (!ctx) return null
  return { session: ctx.session, user: ctx.user }
}

/**
 * Resolve a sessão COM o contexto de impersonação (Fase 20) — usada por
 * /api/v1/auth/me e pelas rotas de impersonação, que precisam distinguir o
 * usuário real (suporte) do usuário efetivo (alvo).
 */
export async function resolveSessionContext(token: string): Promise<SessionContext | null> {
  const session = await db.authSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { parliamentarian: true } } },
  })
  if (!session) return null
  if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null
  if (!session.user.active) {
    await revokeUserSessions(session.user.id)
    return null
  }

  // F22 — lastUsedAt best-effort: atualiza apenas quando ainda null ou
  // gravado há mais de 5 minutos (evita um write de UPDATE por request).
  // Fire-and-forget: falha de escrita jamais derruba a sessão válida.
  if (Date.now() - (session.lastUsedAt?.getTime() ?? 0) > LAST_USED_THROTTLE_MS) {
    void db.authSession
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined)
  }

  const sessionUser = session.user
  const impersonation = session.impersonationId
    ? await activeImpersonationForSession(session)
    : null

  return {
    session,
    user: impersonation ? impersonation.targetUser : sessionUser,
    sessionUser,
    impersonation,
  }
}

/**
 * Impersonação ativa da sessão, com expiração LAZY: prazo vencido, impersonação
 * já encerrada por outra via ou alvo desativado → encerra agora
 * (endedAt=now + limpa impersonationId de TODAS as sessões) e devolve null
 * (a sessão volta a enxergar o próprio suporte).
 */
async function activeImpersonationForSession(
  session: AuthSession
): Promise<ActiveImpersonation | null> {
  const imp = await db.supportImpersonation.findUnique({
    where: { id: session.impersonationId as string },
    include: {
      supportUser: { include: { parliamentarian: true } },
      targetUser: { include: { parliamentarian: true } },
    },
  })
  // Referência órfã/inválida ou sessão que não pertence ao suporte da
  // impersonação → limpeza lazy e segue como o usuário real.
  if (!imp || imp.supportUserId !== session.userId) {
    await db.authSession.updateMany({
      where: { id: session.id },
      data: { impersonationId: null },
    })
    return null
  }
  if (
    imp.endedAt ||
    imp.expiresAt.getTime() <= Date.now() ||
    !imp.targetUser.active
  ) {
    await endImpersonation(imp.id)
    return null
  }
  return {
    impersonationId: imp.id,
    supportName: imp.supportUser.name,
    targetName: imp.targetUser.name,
    reason: imp.reason,
    expiresAt: imp.expiresAt,
    targetUser: imp.targetUser,
  }
}

/**
 * Encerra uma impersonação (idempotente): endedAt=now quando ainda aberta e
 * limpa `impersonationId` de TODAS as sessões que a carregam. Usada pela
 * rota /platform/impersonations/:id/end, pela expiração lazy e pelo hook de
 * logout — sem auditoria aqui (a rota explícita audita
 * `support.impersonation_ended`; expiração/logout registram o fato via
 * endedAt na própria SupportImpersonation).
 */
export async function endImpersonation(impersonationId: string): Promise<void> {
  await db.supportImpersonation.updateMany({
    where: { id: impersonationId, endedAt: null },
    data: { endedAt: new Date() },
  })
  await db.authSession.updateMany({
    where: { impersonationId },
    data: { impersonationId: null },
  })
}

/**
 * Revoga uma sessão específica (logout).
 * Fase 20 (decisão documentada): logout durante impersonação ENCERRA a
 * impersonação imediatamente — o suporte deixou de operar como o alvo.
 */
export async function revokeSession(token: string): Promise<void> {
  const tokenHash = sha256(token)
  const session = await db.authSession.findUnique({
    where: { tokenHash },
    select: { impersonationId: true },
  })
  if (session?.impersonationId) {
    await endImpersonation(session.impersonationId)
  }
  await db.authSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Revoga TODAS as sessões ativas do usuário (desativação / troca de senha). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await db.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/**
 * Lê o token do cookie `legis_session` direto do header `cookie`
 * (parse manual — sem depender de next/headers, funciona em qualquer Request).
 */
export function getSessionToken(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    if (!value) return null
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return null
}
