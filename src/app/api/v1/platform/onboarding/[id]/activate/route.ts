/**
 * POST /api/v1/platform/onboarding/:id/activate — ativação HUMANA do trial
 * (Onda 5 / Fase 24 — self-onboarding, ADR-025). RBAC platform.manage
 * (exclusivo do platform_owner).
 *
 * Em UMA transação Prisma:
 *  1. cria o Tenant (`slug`, `name=chamberName`, cidade/UF, plano
 *     'profissional', `trialEndsAt = agora + 14 dias`, ativo);
 *  2. cria o usuário OWNER do tenant (e-mail do pedido, papel tenant_admin,
 *     nome derivado do e-mail antes do @, senha temporária de 12 chars
 *     alfanuméricos com hash scrypt);
 *  3. cria a Subscription TRIAL de 14 dias vinculada ao plano profissional
 *     (entitlements reutilizados da Fase 10 — trial = profissional por 14d);
 *  4. marca o pedido como `ativada` + auditoria `platform.onboarding_activated`
 *     NA CADEIA DO NOVO TENANT.
 *
 * A senha temporária é exibida UMA VEZ na resposta (sem SMTP no sandbox —
 * documentado no ADR-025); e-mail já cadastrado globalmente → 422 com detalhe.
 * Apenas pedidos `pendente` podem ser ativados (senão 422).
 */
import { randomInt } from 'crypto'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { hashPassword } from '@/lib/server/session'
import { writeAudit } from '@/lib/server/audit'
import type { OnboardingRequest } from '@prisma/client'
import type { OnboardingRequestView, OnboardingStatus } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

/** Duração do trial de onboarding (dias) — espelha o contrato comercial. */
const TRIAL_DAYS = 14
/** Comprimento da senha temporária do owner (alfanumérico). */
const TEMP_PASSWORD_LENGTH = 12

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Senha temporária aleatória (randomInt criptográfico, alfanumérico). */
function generateTemporaryPassword(): string {
  let out = ''
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)]
  }
  return out
}

/** Nome do owner derivado do e-mail antes do @, capitalizado ("joao.prado@…" → "Joao Prado"). */
function ownerNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'Responsável'
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  const name = words.join(' ').trim()
  return name.length >= 2 ? name : 'Responsável'
}

/** Serialização canônica do pedido (contrato OnboardingRequestView). */
function toOnboardingRequestView(r: OnboardingRequest): OnboardingRequestView {
  return {
    id: r.id,
    chamberName: r.chamberName,
    city: r.city,
    uf: r.uf,
    email: r.email,
    slug: r.slug,
    status: r.status as OnboardingStatus,
    note: r.note ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params

    const request = await db.onboardingRequest.findUnique({ where: { id } })
    if (!request) throw notFound('Pedido de onboarding não encontrado.')
    if (request.status !== 'pendente') {
      throw new DomainError(
        'VALIDATION_ERROR',
        422,
        'Pedido não está pendente',
        `O pedido "${request.chamberName}" não pode ser ativado: status atual ` +
          `"${request.status}" (apenas pedidos pendentes podem ser ativados).`
      )
    }

    // E-mail é ÚNICO globalmente (User.email @unique) — validar ANTES da
    // transação para devolver 422 claro em vez de P2002 opaco.
    const emailOwner = await db.user.findUnique({ where: { email: request.email } })
    if (emailOwner) {
      throw new DomainError(
        'EMAIL_TAKEN',
        422,
        'E-mail já cadastrado',
        `O e-mail ${request.email} já pertence ao usuário "${emailOwner.name}" ` +
          '(o login é global na plataforma). Rejeite o pedido orientando a usar outro e-mail ' +
          'ou vincule um responsável diferente.'
      )
    }

    const plan = await db.plan.findUnique({ where: { name: 'profissional' } })
    if (!plan) {
      throw notFound('Plano "profissional" não encontrado — execute o seed da plataforma.')
    }

    const temporaryPassword = generateTemporaryPassword()
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

    const activated = await withTransaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: request.slug,
          name: request.chamberName,
          city: request.city,
          uf: request.uf,
          plan: 'profissional',
          primaryColor: '#062f63',
          accentColor: '#d9a441',
          timezone: 'America/Sao_Paulo',
          settings: JSON.stringify({
            quorumMinimum: 5,
            allowVoteChange: true,
            speechDefaultSeconds: 300,
            soundAlerts: true,
            hidePartialByDefault: false,
          }),
          active: true,
          trialEndsAt,
        },
      })

      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: ownerNameFromEmail(request.email),
          email: request.email,
          role: 'tenant_admin',
          jobTitle: 'Responsável pela câmara (onboarding)',
          passwordHash: hashPassword(temporaryPassword),
          active: true,
        },
      })

      // Trial = plano profissional por 14 dias (entitlements da Fase 10).
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'trial',
          trialEndsAt,
        },
      })

      const updated = await tx.onboardingRequest.update({
        where: { id: request.id },
        data: { status: 'ativada' },
      })

      await writeAudit(tx, {
        tenantId: tenant.id,
        actor,
        action: 'platform.onboarding_activated',
        aggregateType: 'onboarding_request',
        aggregateId: request.id,
        summary:
          `Trial ativado via self-onboarding: tenant "${tenant.name}" (${tenant.slug}) criado ` +
          `no plano profissional por ${TRIAL_DAYS} dias (até ${trialEndsAt.toLocaleDateString('pt-BR')}); ` +
          `owner "${owner.name}" <${owner.email}> com senha temporária (exibida uma única vez).`,
        before: { status: 'pendente', slug: request.slug },
        after: { status: 'ativada', tenantId: tenant.id, trialEndsAt: trialEndsAt.toISOString() },
        correlationId,
      })

      return updated
    })

    return Response.json({
      request: toOnboardingRequestView(activated),
      tenantName: request.chamberName,
      temporaryPassword,
      message:
        `Trial de ${TRIAL_DAYS} dias ativado para "${request.chamberName}". ` +
        'A senha temporária do responsável é exibida UMA única vez — copie e entregue por canal seguro.',
    })
  }
)
