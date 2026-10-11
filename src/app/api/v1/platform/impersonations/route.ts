/**
 * GET/POST /api/v1/platform/impersonations — impersonação auditada de suporte
 * (Fase 20 / ADR-021).
 *
 * - GET (RBAC `platform.read`): histórico (ativos primeiro, startedAt desc),
 *   a impersonação ATIVA da sessão atual (se houver) e os alvos elegíveis
 *   (usuários ativos com tenant, papéis NÃO-platform — impersonar
 *   platform_owner/platform_support seria escalonamento de privilégio).
 * - POST (RBAC `impersonation.manage`): {targetUserId, reason, minutes} —
 *   EXIGE sessão autenticada por SENHA do próprio suporte (cookie
 *   `legis_session`; o modo demo x-actor-id não tem sessão → 409 explicando).
 *   Cria a SupportImpersonation, acopla `impersonationId` à sessão atual do
 *   suporte e audita `support.impersonation_started` na cadeia do tenant do
 *   ALVO com actorName "Nome (Suporte)". Regras: motivo ≥ 10 caracteres;
 *   prazo 5–60 min (default 30); uma impersonação ATIVA por suporte
 *   (vencida sem leitura lazy é encerrada na hora); alvo ativo, com tenant e
 *   papel não-platform.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound, unauthenticated } from '@/lib/server/errors'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import {
  endImpersonation,
  getSessionToken,
  resolveSessionContext,
} from '@/lib/server/session'
import {
  PLATFORM_ROLES,
  optionalSessionContext,
  resolveSupportActor,
  toImpersonationView,
} from '@/lib/server/impersonation'
import type { Role, SupportImpersonationView } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

/**
 * Alvos elegíveis (usuários ativos com tenant, papéis NÃO-platform) — formato
 * definido localmente (o briefing autoriza apenas `impersonation?` em ActorView
 * em contracts.ts).
 */
type ImpersonationTarget = {
  id: string
  name: string
  email: string
  role: Role
  jobTitle: string | null
}

const startSchema = z.object({
  targetUserId: z.string().trim().min(1, 'Informe o usuário-alvo da impersonação.'),
  reason: z
    .string()
    .trim()
    .min(10, 'Motivo obrigatório (mínimo 10 caracteres) — fica registrado na auditoria.')
    .max(500, 'Motivo deve ter no máximo 500 caracteres.'),
  minutes: z.coerce
    .number()
    .int('Prazo deve ser um número inteiro de minutos.')
    .min(5, 'Prazo mínimo de 5 minutos.')
    .max(60, 'Prazo máximo de 60 minutos.')
    .default(30),
})

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveSupportActor(req)
  requirePermission(actor, 'platform.read')

  // Histórico: ativos primeiro (startedAt desc), depois encerrados (startedAt desc).
  const rows = await db.supportImpersonation.findMany({
    include: { supportUser: { select: { name: true } }, targetUser: { select: { name: true } } },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })
  const history = rows
    .map((r) => toImpersonationView(r, r.supportUser.name, r.targetUser.name))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    })

  // Ativa da SESSÃO atual (resolveSessionContext só devolve impersonação ATIVA —
  // expirada é encerrada lazy dentro da própria resolução).
  const ctx = await optionalSessionContext(req)
  let active: SupportImpersonationView | null = null
  if (ctx?.impersonation) {
    const row = await db.supportImpersonation.findUnique({
      where: { id: ctx.impersonation.impersonationId },
      include: { supportUser: { select: { name: true } }, targetUser: { select: { name: true } } },
    })
    if (row) active = toImpersonationView(row, row.supportUser.name, row.targetUser.name)
  }

  // Alvos elegíveis: ativos, com tenant, papéis não-platform.
  const targetRows = await db.user.findMany({
    where: {
      active: true,
      tenantId: { not: null },
      role: { notIn: PLATFORM_ROLES },
    },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, email: true, role: true, jobTitle: true },
  })
  const targets: ImpersonationTarget[] = targetRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    jobTitle: u.jobTitle ?? null,
  }))

  return Response.json({ history, active, targets })
})

export const POST = apiHandler(
  async (req: Request, _ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    // A impersonação é acoplada à SESSÃO do suporte (banner + escopo): exige
    // login por senha. O modo demo (x-actor-id) não tem sessão → 409.
    const token = getSessionToken(req)
    if (!token) {
      throw new DomainError(
        'CONFLICT_VERSION',
        409,
        'Sessão obrigatória',
        'A impersonação exige autenticação por senha (cookie de sessão). Entre com e-mail e senha — o modo de perfis de demonstração (x-actor-id) não permite operar como outro usuário.'
      )
    }
    const ctx = await resolveSessionContext(token)
    if (!ctx) throw unauthenticated('Sessão inválida ou expirada. Entre novamente com e-mail e senha.')

    const supportUser = ctx.sessionUser
    requirePermission(
      {
        id: supportUser.id,
        name: supportUser.name,
        role: supportUser.role as Role,
        jobTitle: supportUser.jobTitle ?? null,
        tenantId: supportUser.tenantId ?? null,
        parliamentarianId: supportUser.parliamentarianId ?? null,
        isPlatform: PLATFORM_ROLES.includes(supportUser.role as Role),
      },
      'impersonation.manage'
    )

    const body = startSchema.parse(await req.json())

    // ─── Alvo: existe, ativo, com tenant e papel NÃO-platform ────────────────
    const target = await db.user.findUnique({
      where: { id: body.targetUserId },
      include: { tenant: { select: { id: true, name: true } } },
    })
    if (!target) throw notFound('Usuário-alvo não encontrado.')
    if (PLATFORM_ROLES.includes(target.role as Role)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Escalonamento de privilégio proibido',
        'Não é permitido impersonar papéis da plataforma (platform_owner/platform_support). Escolha um usuário de um tenant.'
      )
    }
    if (!target.active) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Alvo inválido',
        'O usuário-alvo está inativo e não pode ser impersonado.'
      )
    }
    if (!target.tenantId || !target.tenant) {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Alvo inválido',
        'O usuário-alvo não tem vínculo com um tenant e não pode ser impersonado.'
      )
    }
    // Estreitamento preservado dentro da transação (const com tipo já estreito).
    const targetTenantId: string = target.tenantId
    const targetTenantName: string = target.tenant.name

    // ─── Uma impersonação ATIVA por suporte (vencida → encerra lazy) ─────────
    const openImp = await db.supportImpersonation.findFirst({
      where: { supportUserId: supportUser.id, endedAt: null },
      orderBy: { startedAt: 'desc' },
      include: { targetUser: { select: { name: true } } },
    })
    if (openImp) {
      if (openImp.expiresAt.getTime() > Date.now()) {
        throw new DomainError(
          'VALIDATION_ERROR',
          422,
          'Impersonação já ativa',
          `Já existe uma impersonação ativa como ${openImp.targetUser.name} — encerre-a antes de iniciar outra.`
        )
      }
      // Prazo vencido sem leitura lazy → encerra agora e prossegue.
      await endImpersonation(openImp.id)
    }

    // ─── Cria + acopla à sessão atual + audita (transação única) ─────────────
    const startedAt = new Date()
    const expiresAt = new Date(startedAt.getTime() + body.minutes * 60_000)
    const created = await withTransaction(async (tx) => {
      const imp = await tx.supportImpersonation.create({
        data: {
          supportUserId: supportUser.id,
          targetUserId: target.id,
          reason: body.reason,
          startedAt,
          expiresAt,
        },
      })
      // Acopla a impersonação à sessão QUE fez o request (banner + escopo).
      await tx.authSession.updateMany({
        where: { id: ctx.session.id, revokedAt: null },
        data: { impersonationId: imp.id },
      })
      await writeAudit(tx, {
        tenantId: targetTenantId,
        actor: { name: `${supportUser.name} (Suporte)`, role: supportUser.role as Role },
        action: 'support.impersonation_started',
        aggregateType: 'support_impersonation',
        aggregateId: imp.id,
        summary:
          `Suporte iniciou operação como ${target.name} (${targetTenantName}) por ${body.minutes} min — ` +
          'banner visível, prazo limitado e ações auditadas.',
        before: { activeImpersonation: null, sessionImpersonationId: null },
        after: {
          impersonationId: imp.id,
          supportUser: supportUser.name,
          targetUser: target.name,
          targetTenant: targetTenantName,
          reason: body.reason,
          minutes: body.minutes,
          expiresAt: expiresAt.toISOString(),
        },
        justification: body.reason,
        correlationId,
      })
      return imp
    })

    return Response.json(toImpersonationView(created, supportUser.name, target.name), {
      status: 201,
    })
  }
)
