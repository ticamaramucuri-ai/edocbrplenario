/**
 * GET|POST /api/v1/sessions/:id/speeches
 * POST enfileira discurso (parliamentarianId OU externalSpeaker obrigatório),
 * plannedSeconds default do tenant. Emite `speech.state_changed` (fila).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { tenantSettings } from '@/lib/server/domain'
import { toSpeechView } from '@/lib/server/serializers'
import { SESSION_STATUS_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const speeches = await db.speech.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    include: { parliamentarian: true },
  })
  return Response.json({ speeches: speeches.map(toSpeechView) })
})

const bodySchema = z
  .object({
    parliamentarianId: z.string().min(1).optional(),
    externalSpeaker: z.string().min(2).max(120).optional(),
    kind: z.enum(['grande_expediente', 'explicacoes_pessoais', 'consideracoes_finais', 'homenagem', 'ordem']),
    subject: z.string().max(300).optional(),
    side: z.enum(['situacao', 'oposicao', 'neutro']).optional(),
    plannedSeconds: z.number().int().min(30).max(3600).optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.parliamentarianId && !body.externalSpeaker) {
      ctx.addIssue({
        code: 'custom',
        path: ['parliamentarianId'],
        message: 'Informe o parlamentar ou o nome do orador externo.',
      })
    }
  })

const ENQUEUE_STATUSES = ['check_in', 'open', 'suspended', 'resumed']

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'speech.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, id)
  if (!ENQUEUE_STATUSES.includes(session.status)) {
    throw new DomainError(
      'SPEECH_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Discursos só podem ser enfileirados com a sessão em credenciamento/aberta/suspensa/retomada — status atual: ${SESSION_STATUS_LABEL[session.status as keyof typeof SESSION_STATUS_LABEL] ?? session.status}.`
    )
  }

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId } })
  const settings = tenantSettings(tenant ?? { settings: '{}' })
  const parliamentarian = body.parliamentarianId
    ? await db.parliamentarian.findFirst({
        where: { id: body.parliamentarianId, tenantId: session.tenantId, active: true },
      })
    : null
  if (body.parliamentarianId && !parliamentarian) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Parlamentar não encontrado (ou inativo) neste tenant.',
      { errors: { parliamentarianId: ['Parlamentar inexistente no escopo do tenant.'] } }
    )
  }

  const speech = await withTransaction(async (tx) => {
    const created = await tx.speech.create({
      data: {
        sessionId: session.id,
        parliamentarianId: parliamentarian?.id ?? null,
        externalSpeaker: parliamentarian ? null : (body.externalSpeaker ?? null),
        kind: body.kind,
        subject: body.subject ?? null,
        side: body.side ?? null,
        status: 'fila',
        plannedSeconds: body.plannedSeconds ?? settings.speechDefaultSeconds,
        elapsedSeconds: 0,
        timerEvents: JSON.stringify([]),
      },
      include: { parliamentarian: true },
    })

    const speakerName = parliamentarian?.name ?? body.externalSpeaker ?? 'Orador externo'
    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'speech.created',
      aggregateType: 'speech',
      aggregateId: created.id,
      summary: `Discurso enfileirado: ${speakerName} — ${body.kind}${body.subject ? ` (${body.subject.slice(0, 60)})` : ''}.`,
      after: { status: 'fila', plannedSeconds: created.plannedSeconds },
      correlationId,
      ip: clientIp(req),
    })

    const payload = {
      sessionId: session.id,
      speechId: created.id,
      speakerName,
      subject: created.subject,
      status: created.status,
      elapsedSeconds: created.elapsedSeconds,
      plannedSeconds: created.plannedSeconds,
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'speech.state_changed',
      aggregateId: created.id,
      sessionId: session.id,
      aggregateVersion: 1,
      correlationId,
      internalPayload: payload,
      publicPayload: payload,
    })

    return created
  })

  return Response.json(
    { speech: toSpeechView({ ...speech, parliamentarian }) },
    { status: 201 }
  )
})
