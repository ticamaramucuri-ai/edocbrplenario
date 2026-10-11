/**
 * POST /api/v1/me/speech {kind, subject?, side?} — entrar na fila de oradores
 * pelo app. Sessão-alvo deve estar ABERTA (open); status inicial 'fila' com
 * plannedSeconds do tenant. Auditoria speech.created (origem PWA) + outbox
 * speech.state_changed (público — a fila aparece no telão). RBAC: self.speech.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { requireMeParliamentarian, targetSessionForTenant } from '@/lib/server/me'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { tenantSettings } from '@/lib/server/domain'
import { SESSION_STATUS_LABEL, SPEECH_KIND_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  kind: z.enum(['grande_expediente', 'explicacoes_pessoais', 'consideracoes_finais', 'homenagem', 'ordem']),
  subject: z.string().max(300).optional(),
  side: z.enum(['situacao', 'oposicao', 'neutro']).optional(),
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'self.speech')
  const parliamentarian = await requireMeParliamentarian(actor)
  const body = bodySchema.parse(await req.json())

  const session = await targetSessionForTenant(parliamentarian.tenantId)
  if (!session || session.status !== 'open') {
    const atual = session
      ? (SESSION_STATUS_LABEL[session.status as keyof typeof SESSION_STATUS_LABEL] ?? session.status)
      : 'nenhuma sessão'
    throw new DomainError(
      'SPEECH_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `O pedido de palavra pelo app exige sessão ABERTA — status atual da sessão-alvo: ${atual}.`
    )
  }

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId } })
  const settings = tenantSettings(tenant ?? { settings: '{}' })

  const result = await withTransaction(async (tx) => {
    // Um pedido por vez: parlamentar já na fila → devolve a posição atual.
    const alreadyQueued = await tx.speech.findFirst({
      where: { sessionId: session.id, parliamentarianId: parliamentarian.id, status: 'fila' },
      orderBy: { createdAt: 'asc' },
    })
    if (alreadyQueued) {
      const queue = await tx.speech.findMany({
        where: { sessionId: session.id, status: 'fila' },
        orderBy: { createdAt: 'asc' },
      })
      const position = queue.findIndex((s) => s.id === alreadyQueued.id) + 1
      return { speech: alreadyQueued, position, total: queue.length, existed: true }
    }

    const created = await tx.speech.create({
      data: {
        sessionId: session.id,
        parliamentarianId: parliamentarian.id,
        externalSpeaker: null,
        kind: body.kind,
        subject: body.subject ?? null,
        side: body.side ?? null,
        status: 'fila',
        plannedSeconds: settings.speechDefaultSeconds,
        elapsedSeconds: 0,
        timerEvents: JSON.stringify([]),
      },
    })

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'speech.created',
      aggregateType: 'speech',
      aggregateId: created.id,
      summary: `Pedido de palavra via app: ${parliamentarian.name} — ${SPEECH_KIND_LABEL[body.kind] ?? body.kind}${body.subject ? ` (${body.subject.slice(0, 60)})` : ''}.`,
      after: { status: 'fila', plannedSeconds: created.plannedSeconds, source: 'pwa' },
      correlationId,
      ip: clientIp(req),
    })

    const payload = {
      sessionId: session.id,
      speechId: created.id,
      speakerName: parliamentarian.name,
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
      origin: 'pwa',
      internalPayload: payload,
      publicPayload: payload,
    })

    const queue = await tx.speech.findMany({
      where: { sessionId: session.id, status: 'fila' },
      orderBy: { createdAt: 'asc' },
    })
    return {
      speech: created,
      position: queue.findIndex((s) => s.id === created.id) + 1,
      total: queue.length,
      existed: false,
    }
  })

  return Response.json(
    {
      speech: {
        id: result.speech.id,
        status: result.speech.status,
        position: result.position,
        total: result.total,
      },
      message: result.existed
        ? 'Você já está na fila de oradores — posição mantida.'
        : `Pedido registrado — ${result.position}º na fila (${result.total} no total).`,
    },
    { status: result.existed ? 200 : 201 }
  )
})
