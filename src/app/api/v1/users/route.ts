/**
 * GET|POST /api/v1/users — gestão de usuários (Fase 9, RBAC user.manage).
 *
 * GET: tenant_admin lista apenas o próprio tenant; platform_owner lista
 *      `?tenant=slug` (resolveTenantScope) ou TODOS os tenants com `?all=1`
 *      (inclui nome do tenant; resposta traz `tenants` para o seletor de
 *      escopo na criação). Nunca expõe passwordHash.
 * POST: cria usuário COM senha (scrypt). O novo usuário pertence ao tenant do
 *      escopo — platform_owner DEVE informar `?tenant=slug` (senão 422).
 *      E-mail único (409 EMAIL_TAKEN); papel parliamentarian exige vínculo
 *      com parlamentar do mesmo tenant (422). Auditoria `user.created`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, type ResolvedActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { hashPassword } from '@/lib/server/session'
import { ROLE_LABEL, type Role } from '@/lib/contracts'

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

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'user.manage')
  const all = new URL(req.url).searchParams.get('all') === '1'

  const where: Prisma.UserWhereInput = actor.isPlatform
    ? all
      ? {} // plataforma em modo global: todos os tenants + equipe da plataforma
      : { tenantId: await resolveTenantScope(req as NextRequest, actor) }
    : { tenantId: actor.tenantId as string }

  const [users, tenants] = await Promise.all([
    db.user.findMany({ where, include: { parliamentarian: true, tenant: true }, orderBy: { name: 'asc' } }),
    // Equipe da plataforma recebe a lista de tenants (seletor do dialog de criação).
    actor.isPlatform
      ? db.tenant.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, slug: true, name: true, active: true },
        })
      : Promise.resolve(null),
  ])

  return Response.json({
    users: users.map(toUserView),
    ...(tenants ? { tenants } : {}),
  })
})

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter entre 2 e 120 caracteres.').max(120),
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres.'),
  role: z.enum(USER_ROLES),
  jobTitle: z.string().trim().max(120).optional(),
  parliamentarianId: z.string().min(1).optional(),
})

/** Escopo de criação: tenant_admin usa o próprio tenant; plataforma DEVE informar ?tenant=slug. */
async function tenantScopeForCreate(req: Request, actor: ResolvedActor): Promise<string> {
  if (!actor.isPlatform) return actor.tenantId as string
  const slug = new URL(req.url).searchParams.get('tenant')?.trim()
  if (!slug) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Operador da plataforma deve informar ?tenant=slug do tenant do novo usuário.'
    )
  }
  return resolveTenantScope(req as NextRequest, actor)
}

export const POST = apiHandler(async (req: Request, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'user.manage')
  const body = createSchema.parse(await req.json())
  const email = body.email.toLowerCase()
  const tenantId = await tenantScopeForCreate(req, actor)

  const emailTaken = await db.user.findUnique({ where: { email } })
  if (emailTaken) {
    throw new DomainError('EMAIL_TAKEN', 409, 'E-mail já cadastrado', `O e-mail ${email} já pertence a um usuário.`)
  }

  // Vínculo com parlamentar: se informado, deve ser do próprio tenant e
  // não pode já estar vinculado a outro usuário (parliamentarianId é unique).
  let parliamentarianId: string | null = null
  if (body.parliamentarianId) {
    const parl = await db.parliamentarian.findUnique({ where: { id: body.parliamentarianId } })
    if (!parl || parl.tenantId !== tenantId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        'Parlamentar vinculado não encontrado neste tenant.'
      )
    }
    const linked = await db.user.findUnique({ where: { parliamentarianId: parl.id } })
    if (linked) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Dados inválidos',
        `Parlamentar ${parl.name} já está vinculado a outro usuário.`
      )
    }
    parliamentarianId = parl.id
  }
  if (body.role === 'parliamentarian' && !parliamentarianId) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Papel parliamentarian exige vínculo com parlamentar do tenant.'
    )
  }

  const created = await withTransaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId,
        name: body.name,
        email,
        role: body.role,
        jobTitle: body.jobTitle ?? null,
        parliamentarianId,
        passwordHash: hashPassword(body.password),
        active: true,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'user.created',
      aggregateType: 'user',
      aggregateId: user.id,
      summary: `Usuário criado: ${user.name} (${user.email}) — papel ${ROLE_LABEL[user.role as Role] ?? user.role}.`,
      after: {
        name: user.name,
        email: user.email,
        role: user.role,
        jobTitle: user.jobTitle,
        active: user.active,
      },
      correlationId,
      ip: clientIp(req),
    })
    return user
  })

  const view = await db.user.findUnique({
    where: { id: created.id },
    include: { parliamentarian: true, tenant: true },
  })
  if (!view) throw notFound('Usuário criado não encontrado (inconsistência).')
  return Response.json({ user: toUserView(view) }, { status: 201 })
})
