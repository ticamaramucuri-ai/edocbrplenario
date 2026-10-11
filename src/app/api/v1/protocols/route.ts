/**
 * GET|POST /api/v1/protocols — livro de protocolo do tenant.
 * GET: filtros year/status/kind + contagens por status.
 * POST: RBAC protocol.write; auto-numeração por (tenant, ano) dentro da
 * transação — sem buracos por tenant. Emite outbox `protocol.registered`.
 */
import type { NextRequest } from 'next/server'
import type { LegislativeMatter } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toProtocolEntryView } from '@/lib/server/serializers'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const params = req.nextUrl.searchParams
  const yearRaw = params.get('year')?.trim()
  const status = params.get('status')?.trim()
  const kind = params.get('kind')?.trim()

  let year: number | undefined
  if (yearRaw) {
    year = Number(yearRaw)
    if (!Number.isInteger(year) || String(year).length !== 4) year = undefined
  }

  const where = {
    tenantId,
    ...(year ? { year } : {}),
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
  }
  const [protocols, counts] = await Promise.all([
    db.protocolEntry.findMany({ where, orderBy: [{ year: 'desc' }, { number: 'desc' }], take: 300 }),
    db.protocolEntry.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    }),
  ])
  const countsMap: Record<string, number> = { recebido: 0, distribuido: 0, arquivado: 0, anulado: 0 }
  for (const g of counts) countsMap[g.status] = g._count._all

  return Response.json({
    protocols: protocols.map(toProtocolEntryView),
    counts: countsMap,
  })
})

const createSchema = z.object({
  kind: z.enum(['materia', 'documento', 'oficio', 'requerimento']),
  senderName: z.string().min(3, 'Remetente obrigatório.').max(120),
  subject: z.string().min(5, 'Assunto obrigatório.').max(300),
  matterId: z.string().nullable().optional(),
  notes: z.string().max(2000).optional(),
  year: z.number().int().min(1990).max(2100).optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'protocol.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = createSchema.parse(await req.json())
  const year = body.year ?? new Date().getFullYear()

  let matter: LegislativeMatter | null = null
  if (body.matterId) {
    matter = await db.legislativeMatter.findUnique({ where: { id: body.matterId } })
    if (!matter) throw notFound('Matéria vinculada não encontrada.')
    assertTenantScope(actor, matter.tenantId)
  }

  const protocol = await withTransaction(async (tx) => {
    const last = await tx.protocolEntry.findFirst({
      where: { tenantId, year },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    const number = (last?.number ?? 0) + 1
    const created = await tx.protocolEntry.create({
      data: {
        tenantId,
        number,
        year,
        kind: body.kind,
        senderName: body.senderName.trim(),
        subject: body.subject.trim(),
        matterId: matter?.id ?? null,
        status: 'recebido',
        notes: body.notes?.trim() ?? null,
      },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: 'protocol.registered',
      aggregateType: 'protocol',
      aggregateId: created.id,
      summary: `Protocolo nº ${number}/${year} registrado (${body.kind}): ${created.subject.slice(0, 60)}.`,
      after: { number, year, kind: created.kind, senderName: created.senderName },
      correlationId,
      ip: clientIp(req),
    })
    await emitOutbox(tx, {
      tenantId,
      eventType: 'protocol.registered',
      aggregateId: created.id,
      aggregateVersion: 1,
      correlationId,
      origin: 'operator',
      internalPayload: {
        protocolId: created.id,
        number,
        year,
        kind: created.kind,
        senderName: created.senderName,
        subject: created.subject,
        status: created.status,
      },
    })
    return created
  })

  return Response.json({ protocol: toProtocolEntryView(protocol) }, { status: 201 })
})
