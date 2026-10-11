/**
 * GET /api/v1/sessions/:id — SessionDetail completo
 * (agenda, presença atual, quórum, votações com votos, discursos).
 * Votos de votação SECRETA retornam votes: null (transparência nominal
 * apenas para os demais modos — ADR-002 §6).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'
import { buildSessionDetail, buildSessionSummaries } from '@/lib/server/serializers'
import { requirePermission } from '@/lib/server/rbac'
import { tenantSettings } from '@/lib/server/domain'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  return Response.json(await buildSessionDetail(db, session))
})

const updateSchema = z.object({
  version: z.number().int().positive(),
  type: z.enum(['ordinaria', 'extraordinaria', 'solene', 'especial']).optional(),
  scheduledAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Data/hora inválida.').optional(),
  presidentId: z.string().min(1).optional(),
  secretaryName: z.string().max(120).nullable().optional(),
  location: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== 'version'), 'Informe ao menos um campo para atualizar.')

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.create')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const body = updateSchema.parse(await req.json())
  if (session.status !== 'draft') {
    throw new DomainError('SESSION_INVALID_TRANSITION', 409, 'Sessão publicada', 'Somente rascunhos podem ter os dados de preparação editados.')
  }
  if (session.version !== body.version) {
    throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A sessão foi alterada. Recarregue antes de salvar.')
  }

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId }, select: { timezone: true, settings: true } })
  if (!tenant) throw notFound('Câmara não encontrada.')
  if (body.type && !tenantSettings(tenant).enabledSessionTypes.includes(body.type)) {
    throw new DomainError('SESSION_TYPE_DISABLED', 422, 'Tipo indisponível', 'Este tipo de sessão está desabilitado nesta Câmara.')
  }
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined
  if (scheduledAt) {
    const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: tenant.timezone, year: 'numeric' }).format(scheduledAt))
    if (year !== session.year) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Ano diferente', 'A data deve permanecer no ano de numeração da sessão.')
    }
  }
  const president = body.presidentId ? await db.parliamentarian.findFirst({
    where: { id: body.presidentId, tenantId: session.tenantId, active: true },
  }) : null
  if (body.presidentId && !president) throw notFound('Presidente ativo não encontrado nesta Câmara.')

  const updated = await withTransaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { id, tenantId: session.tenantId, status: 'draft', version: body.version },
      data: {
        ...(body.type !== undefined && { type: body.type }),
        ...(scheduledAt && { scheduledAt }),
        ...(president && { presidentId: president.id, presidentName: president.name }),
        ...(body.secretaryName !== undefined && { secretaryName: body.secretaryName?.trim() || null }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.notes !== undefined && { notes: body.notes?.trim() || null }),
        version: { increment: 1 },
      },
    })
    if (result.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A sessão foi alterada. Recarregue antes de salvar.')
    const current = await tx.session.findUniqueOrThrow({ where: { id } })
    await writeAudit(tx, {
      tenantId: session.tenantId, actor, action: 'session.draft_updated', aggregateType: 'session', aggregateId: id,
      summary: 'Dados de preparação do rascunho atualizados.',
      before: { type: session.type, scheduledAt: session.scheduledAt, presidentId: session.presidentId, secretaryName: session.secretaryName, location: session.location, notes: session.notes },
      after: { type: current.type, scheduledAt: current.scheduledAt, presidentId: current.presidentId, secretaryName: current.secretaryName, location: current.location, notes: current.notes },
      correlationId, ip: clientIp(req),
    })
    return current
  })
  const [summary] = await buildSessionSummaries(db, session.tenantId, [updated])
  return Response.json({ session: summary })
})
