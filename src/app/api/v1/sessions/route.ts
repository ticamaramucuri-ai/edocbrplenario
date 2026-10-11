/**
 * GET  /api/v1/sessions — lista com presentCount/agendaCount/totalMembers.
 * POST /api/v1/sessions — cria sessão sempre em rascunho (RBAC session.create),
 * com pauta preliminar. Publicação exige transição explícita `schedule`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { buildSessionSummaries, matterLabel, toSessionSummary } from '@/lib/server/serializers'
import { clientIp } from '@/lib/server/errors'
import { MATTER_TYPE_SHORT } from '@/lib/contracts'
import { tenantSettings } from '@/lib/server/domain'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const sessions = await db.session.findMany({
    where: { tenantId },
    orderBy: { scheduledAt: 'desc' },
  })
  return Response.json({ sessions: await buildSessionSummaries(db, tenantId, sessions) })
})

const createSchema = z.object({
  type: z.enum(['ordinaria', 'extraordinaria', 'solene', 'especial']),
  scheduledAt: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Data/hora inválida (ISO 8601 esperado).'),
  presidentId: z.string().min(1, 'Informe o presidente da sessão.'),
  secretaryName: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  matterIds: z.array(z.string().min(1)).optional(),
  official: z.boolean().optional(),
})

const EXPEDIENTE_FIXO = [
  'Abertura dos trabalhos e verificação de quórum pelo Presidente.',
  'Leitura e aprovação da Ata da Sessão anterior.',
  'Leitura de correspondências recebidas.',
]
const COMUNICACOES_FIXO = 'Comunicações da Presidência.'

const truncate = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.create')
  const tenantId = await resolveTenantScope(req, actor)

  const body = createSchema.parse(await req.json())
  const scheduledAt = new Date(body.scheduledAt)
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, settings: true } })
  if (!tenant) throw notFound('Câmara não encontrada.')
  if (!tenantSettings(tenant).enabledSessionTypes.includes(body.type)) {
    throw new DomainError('SESSION_TYPE_DISABLED', 422, 'Tipo indisponível', 'Este tipo de sessão está desabilitado nas configurações desta Câmara.')
  }
  const year = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tenant.timezone,
    year: 'numeric',
  }).format(scheduledAt))

  if (body.matterIds && new Set(body.matterIds).size !== body.matterIds.length) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Dados inválidos', 'A mesma matéria foi incluída mais de uma vez.')
  }

  const president = await db.parliamentarian.findFirst({
    where: { id: body.presidentId, tenantId, active: true },
  })
  if (!president) throw notFound('Presidente (parlamentar) não encontrado neste tenant.')

  // Matérias da ordem do dia (na ordem recebida) — todas do tenant.
  const matters = body.matterIds?.length
    ? await db.legislativeMatter.findMany({ where: { tenantId, id: { in: body.matterIds } } })
    : []
  if (body.matterIds && matters.length !== body.matterIds.length) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Uma ou mais matérias informadas não foram encontradas neste tenant.',
      { errors: { matterIds: ['Matéria(s) inexistente(s) no escopo do tenant.'] } }
    )
  }
  const orderedMatters = body.matterIds
    ? body.matterIds.map((id) => matters.find((m) => m.id === id)).filter((m) => m !== undefined)
    : []

  const created = await withTransaction(async (tx) => {
    const counter = await tx.sessionNumberCounter.upsert({
      where: { tenantId_year: { tenantId, year } },
      create: { tenantId, year, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    })
    const session = await tx.session.create({
      data: {
        tenantId,
        number: counter.lastNumber,
        year,
        type: body.type,
        scheduledAt,
        status: 'draft',
        official: body.official ?? false,
        presidentId: president.id,
        presidentName: president.name,
        secretaryName: body.secretaryName ?? null,
        location: 'Plenário',
        agendaPublished: false,
        notes: body.notes ?? null,
        version: 1,
      },
    })

    // Pauta: expediente fixo + ordem do dia (matérias na ordem recebida) + comunicações
    const items = [
      ...EXPEDIENTE_FIXO.map((title) => ({ section: 'expediente', title, matterId: null })),
      ...orderedMatters.map((m) => ({
        section: 'ordem_do_dia',
        title: truncate(`${matterLabel(m)} — ${m.ementa}`),
        matterId: m!.id,
      })),
      { section: 'comunicacoes', title: COMUNICACOES_FIXO, matterId: null },
    ]
    let order = 0
    for (const item of items) {
      await tx.agendaItem.create({
        data: {
          sessionId: session.id,
          order: order++,
          section: item.section,
          title: item.title,
          matterId: item.matterId,
          kind: 'individual',
          status: 'pendente',
        },
      })
    }
    if (orderedMatters.length) {
      await tx.legislativeMatter.updateMany({
        where: { id: { in: orderedMatters.map((m) => m!.id) } },
        data: { status: 'incluida_pauta' },
      })
    }

    const ip = clientIp(req)
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'session.created',
      aggregateType: 'session',
      aggregateId: session.id,
      summary: `Sessão criada com pauta de ${items.length} itens.`,
      after: { status: session.status, number: session.number, year, type: body.type, official: session.official },
      correlationId,
      ip,
    })
    return session
  })

  const [parliamentarians, agendaCount] = await Promise.all([
    db.parliamentarian.count({ where: { tenantId, active: true } }),
    db.agendaItem.count({ where: { sessionId: created.id } }),
  ])
  return Response.json(
    {
      session: toSessionSummary(created, {
        presentCount: 0,
        agendaCount,
        totalMembers: parliamentarians,
      }),
    },
    { status: 201 }
  )
})
