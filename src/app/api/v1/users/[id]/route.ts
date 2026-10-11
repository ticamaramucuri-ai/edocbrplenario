/**
 * PATCH /api/v1/users/:id — edição de usuário (Fase 9, RBAC user.manage).
 *
 * Body parcial: { name?, jobTitle?, role?, parliamentarianId?, active?,
 * password? }. Regras:
 * - tenant_admin só edita usuários do próprio tenant (plataforma: global);
 * - não é possível desativar o próprio usuário (422);
 * - papel parliamentarian exige vínculo com parlamentar do mesmo tenant (422);
 * - desativar ou trocar senha revoga TODAS as AuthSessions do usuário;
 * - auditoria `user.updated` com before/after SANITIZADO (nunca passwordHash).
 */
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, forbiddenTenant, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { hashPassword } from '@/lib/server/session'
import { ROLE_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const USER_ROLES = [
  'platform_owner',
  'platform_support',
  'tenant_admin',
  'legislative_admin',
  'session_operator',
  'media_operator',
  'presiding_officer',
  'parliamentarian',
  'auditor',
] as const

type UserWithRelations = Prisma.UserGetPayload<{ include: { parliamentarian: true; tenant: true } }>

/** View pública de usuário — SEM passwordHash. */
function toUserView(u: UserWithRelations) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    jobTitle: u.jobTitle ?? null,
    parliamentarianId: u.parliamentarianId ?? null,
    parliamentarianName: u.parliamentarian?.name ?? null,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
    tenantId: u.tenantId ?? null,
    tenantName: u.tenant?.name ?? null,
    tenantSlug: u.tenant?.slug ?? null,
  }
}

/** Estado para auditoria — NUNCA inclui passwordHash. */
function sanitized(u: { name: string; email: string; role: string; jobTitle: string | null; parliamentarianId: string | null; active: boolean }) {
  return {
    name: u.name,
    email: u.email,
    role: u.role,
    jobTitle: u.jobTitle ?? null,
    parliamentarianId: u.parliamentarianId ?? null,
    active: u.active,
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter entre 2 e 120 caracteres.').max(120).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  role: z.enum(USER_ROLES).optional(),
  parliamentarianId: z.string().min(1).nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres.').optional(),
})

export const PATCH = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'user.manage')
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())

  const target = await db.user.findUnique({
    where: { id },
    include: { parliamentarian: true, tenant: true },
  })
  if (!target) throw notFound('Usuário não encontrado.')
  // tenant_admin não edita usuários de outros tenants nem da equipe da plataforma.
  if (!actor.isPlatform && target.tenantId !== actor.tenantId) {
    throw forbiddenTenant('Usuário pertence a outro tenant ou à equipe da plataforma.')
  }

  if (body.active === false && target.id === actor.id) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Não é possível desativar o próprio usuário.'
    )
  }

  // Sem campos → devolve o usuário atual (sem evento de auditoria vazio).
  if (Object.keys(body).length === 0) {
    return Response.json({ user: toUserView(target) })
  }

  const finalRole: string = body.role ?? target.role
  const finalParliamentarianId: string | null =
    body.parliamentarianId !== undefined ? body.parliamentarianId : target.parliamentarianId

  // Vínculo com parlamentar: se informado, do mesmo tenant e não vinculado a outro usuário.
  if (body.parliamentarianId) {
    const parl = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
    if (!parl || parl.tenantId !== target.tenantId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Parlamentar vinculado não encontrado neste tenant.'
      )
    }
    const linked = await db.user.findUnique({ where: { parliamentarianId: parl.id } })
    if (linked && linked.id !== target.id) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        `Parlamentar ${parl.name} já está vinculado a outro usuário.`
      )
    }
  }
  if (finalRole === 'parliamentarian' && !finalParliamentarianId) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Papel parliamentarian exige vínculo com parlamentar do tenant.'
    )
  }

  const data: Prisma.UserUncheckedUpdateInput = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.parliamentarianId !== undefined ? { parliamentarianId: body.parliamentarianId } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    ...(body.password !== undefined ? { passwordHash: hashPassword(body.password) } : {}),
  }

  const updated = await withTransaction(async (tx) => {
    const next = await tx.user.update({ where: { id: target.id }, data })

    // Desativação ou troca de senha revogam TODAS as sessões (força novo login).
    const deactivating = body.active === false
    const resettingPassword = body.password !== undefined
    if (deactivating || resettingPassword) {
      await tx.authSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }

    const changes: string[] = []
    if (body.role !== undefined && body.role !== target.role) {
      changes.push(`papel ${ROLE_LABEL[body.role] ?? body.role}`)
    }
    if (deactivating) changes.push('desativado')
    if (body.active === true && !target.active) changes.push('reativado')
    if (resettingPassword) changes.push('senha redefinida — sessões revogadas')
    if (deactivating) changes.push('sessões revogadas')

    // Auditoria na cadeia do tenant do usuário (equipe da plataforma não tem
    // tenant — sem cadeia própria, o evento é omitido).
    if (target.tenantId) {
      await writeAudit(tx, {
        tenantId: target.tenantId,
        actor,
        action: 'user.updated',
        aggregateType: 'user',
        aggregateId: target.id,
        summary: `Usuário atualizado: ${next.name}${changes.length ? ` — ${changes.join('; ')}` : ''}.`,
        before: sanitized(target),
        after: sanitized(next),
        correlationId,
        ip: clientIp(req),
      })
    }
    return next
  })

  const view = await db.user.findUnique({
    where: { id: updated.id },
    include: { parliamentarian: true, tenant: true },
  })
  if (!view) throw notFound('Usuário atualizado não encontrado (inconsistência).')
  return Response.json({ user: toUserView(view) })
})
