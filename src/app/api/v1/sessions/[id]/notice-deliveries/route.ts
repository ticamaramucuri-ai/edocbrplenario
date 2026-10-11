import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  revision: z.number().int().positive(),
  noticeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  parliamentarianId: z.string().min(1),
  channel: z.enum(['presencial', 'email_externo', 'mensagem_externa', 'outro']),
  evidenceReference: z.string().trim().min(5).max(200),
  deliveredAt: z.string().datetime(),
  commandId: z.string().uuid(),
  acknowledged: z.literal(true),
}).strict()

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const requested = req.nextUrl.searchParams.get('revision')
  const number = requested === null ? null : Number(requested)
  if (requested !== null && (!Number.isInteger(number) || number! < 1)) throw new DomainError('VALIDATION_ERROR', 422, 'Revisão inválida', 'Informe uma revisão positiva.')
  const revision = await db.sessionAgendaRevision.findFirst({ where: { tenantId: session.tenantId, sessionId: id, ...(number !== null && { revision: number }) }, orderBy: { revision: 'desc' }, select: { revision: true, noticeSha256: true } })
  if (number !== null && !revision) throw notFound('Revisão não encontrada nesta sessão.')
  if (!revision) return Response.json({ revision: null, deliveries: [] })
  const deliveries = await db.sessionNoticeDelivery.findMany({ where: { tenantId: session.tenantId, sessionId: id, revision: revision.revision }, orderBy: { createdAt: 'desc' },
    select: { id: true, revision: true, parliamentarianId: true, channel: true, evidenceReference: true, deliveredAt: true, recordedByName: true, createdAt: true } })
  return Response.json({ revision: revision.revision, noticeSha256: revision.noticeSha256, deliveries })
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const body = bodySchema.parse(await req.json())
  const deliveredAt = new Date(body.deliveredAt)
  if (deliveredAt.getTime() > Date.now() + 5 * 60_000) throw new DomainError('VALIDATION_ERROR', 422, 'Data futura', 'A entrega declarada não pode ocorrer no futuro.')
  const result = await withTransaction(async (tx) => {
    const previous = await tx.sessionNoticeDelivery.findUnique({ where: { tenantId_commandId: { tenantId: session.tenantId, commandId: body.commandId } } })
    if (previous) {
      if (previous.sessionId !== id || previous.revision !== body.revision || previous.parliamentarianId !== body.parliamentarianId || previous.channel !== body.channel || previous.evidenceReference !== body.evidenceReference || previous.deliveredAt.getTime() !== deliveredAt.getTime()) {
        throw new DomainError('CONFLICT_VERSION', 409, 'Comando já utilizado', 'Este identificador foi usado com dados diferentes.')
      }
      return { delivery: previous, created: false }
    }
    const revision = await tx.sessionAgendaRevision.findFirst({ where: { tenantId: session.tenantId, sessionId: id }, orderBy: { revision: 'desc' } })
    if (!revision?.noticeSha256 || revision.revision !== body.revision || revision.noticeSha256 !== body.noticeSha256) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Convocação alterada', 'Registre a entrega da revisão vigente da convocação.')
    }
    const recipient = await tx.sessionNoticeRecipient.findFirst({ where: {
      tenantId: session.tenantId, sessionId: id, revision: body.revision,
      parliamentarianId: body.parliamentarianId, noticeSha256: body.noticeSha256,
    } })
    if (!recipient) throw new DomainError('VALIDATION_ERROR', 422, 'Destinatário inválido', 'O parlamentar não consta da revisão desta convocação.')
    if (deliveredAt < recipient.issuedAt) throw new DomainError('VALIDATION_ERROR', 422, 'Data inválida', 'A entrega não pode anteceder a emissão da convocação.')
    const delivery = await tx.sessionNoticeDelivery.create({ data: {
      tenantId: session.tenantId, sessionId: id, revision: body.revision, parliamentarianId: body.parliamentarianId,
      noticeSha256: body.noticeSha256, channel: body.channel, evidenceReference: body.evidenceReference,
      deliveredAt, recordedById: actor.id, recordedByName: actor.name, commandId: body.commandId,
    } })
    await writeAudit(tx, { tenantId: session.tenantId, actor, action: 'notice.delivery_attested', aggregateType: 'session', aggregateId: id,
      summary: `Entrega externa declarada para ${recipient.recipientName}, revisão ${body.revision}.`,
      after: { deliveryId: delivery.id, parliamentarianId: body.parliamentarianId, channel: body.channel, evidenceReference: body.evidenceReference, noticeSha256: body.noticeSha256 },
      correlationId, ip: clientIp(req) })
    return { delivery, created: true }
  })
  return Response.json({ delivery: { id: result.delivery.id, revision: result.delivery.revision, parliamentarianId: result.delivery.parliamentarianId,
    channel: result.delivery.channel, evidenceReference: result.delivery.evidenceReference,
    deliveredAt: result.delivery.deliveredAt.toISOString(), recordedByName: result.delivery.recordedByName },
    mode: 'manual_attestation' }, { status: result.created ? 201 : 200 })
})
