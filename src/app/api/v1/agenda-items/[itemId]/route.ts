/**
 * PATCH /api/v1/agenda-items/:itemId — comandos da pauta:
 * reorder (nova posição absoluta → renumera siblings), status
 * (em_leitura|em_discussao|aprovado|rejeitado), retirar, adiar.
 * Auditoria `agenda.<action>` + outbox `agenda.updated`.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadAgendaItem } from '@/lib/server/loaders'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'
import { toAgendaItemView } from '@/lib/server/serializers'
import { AGENDA_STATUS_LABEL, SESSION_STATUS_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    action: z.enum(['reorder', 'status', 'retirar', 'adiar', 'vista', 'destaque', 'inversao']),
    order: z.number().int().min(0).optional(),
    status: z.enum(['em_leitura', 'em_discussao', 'aprovado', 'rejeitado']).optional(),
    justification: z.string().min(3).max(2000).optional(),
  })
  .superRefine((body, ctx) => {
    if ((body.action === 'reorder' || body.action === 'inversao') && body.order === undefined) {
      ctx.addIssue({ code: 'custom', path: ['order'], message: 'Informe a nova posição (order).' })
    }
    if (body.action === 'status' && !body.status) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Informe o novo status do item.' })
    }
    if (['vista', 'destaque', 'inversao'].includes(body.action) && (!body.justification || body.justification.trim().length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['justification'], message: 'Justificativa obrigatória (mín. 5 caracteres).' })
    }
  })

const ACTIVE_SESSION_STATUSES = ['draft', 'scheduled', 'check_in', 'open', 'suspended', 'resumed']

export const PATCH = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  // Comandos de condução da pauta no plenário → session.transition
  requirePermission(actor, 'session.transition')
  const { itemId } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const item = await loadAgendaItem(actor, itemId)
  const session = await db.session.findUnique({ where: { id: item.sessionId } })
  if (!session) throw new DomainError('NOT_FOUND', 404, 'Não encontrado', 'Sessão não encontrada.')
  if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
    throw new DomainError(
      'AGENDA_INVALID_STATE',
      409,
      'Pauta indisponível',
      `A pauta não aceita comandos com a sessão ${SESSION_STATUS_LABEL[session.status as keyof typeof SESSION_STATUS_LABEL] ?? session.status}.`
    )
  }
  if (body.action === 'reorder' && session.status !== 'draft') {
    throw new DomainError('AGENDA_INVALID_STATE', 409, 'Pauta publicada', 'A ordem da pauta publicada só pode mudar por alteração versionada.')
  }
  if (['scheduled', 'check_in'].includes(session.status) && ['retirar', 'adiar'].includes(body.action)) {
    throw new DomainError('AGENDA_INVALID_STATE', 409, 'Pauta publicada', 'Retirada e adiamento antes da abertura exigem emenda versionada à pauta.')
  }
  if ((body.action === 'status' || ['vista', 'destaque', 'inversao'].includes(body.action)) && !['open', 'suspended', 'resumed'].includes(session.status)) {
    throw new DomainError('AGENDA_INVALID_STATE', 409, 'Sessão não aberta', 'A condução e incidentes regimentais só ocorrem após a abertura da sessão.')
  }

  const agenda = await withTransaction(async (tx) => {
    let summary = ''
    let after: Record<string, unknown> = {}

    if (body.action === 'reorder' || body.action === 'inversao') {
      const items = await tx.agendaItem.findMany({
        where: { sessionId: item.sessionId },
        orderBy: { order: 'asc' },
      })
      const others = items.filter((i) => i.id !== item.id)
      const index = Math.min(Math.max(body.order ?? 0, 0), others.length)
      const reordered = [...others.slice(0, index), item, ...others.slice(index)]
      let order = 0
      for (const it of reordered) {
        await tx.agendaItem.update({ where: { id: it.id }, data: { order: order++ } })
      }
      summary = body.action === 'inversao'
        ? `Inversão de pauta: "${item.title.slice(0, 50)}" movido para posição ${index + 1}.`
        : `Item reordenado para a posição ${index + 1} da pauta.`
      after = { order: index }
    } else if (body.action === 'status') {
      const status = body.status!
      await tx.agendaItem.update({ where: { id: item.id }, data: { status } })
      summary = `Item "${item.title.slice(0, 60)}" → ${AGENDA_STATUS_LABEL[status]}.`
      after = { status }
    } else if (body.action === 'retirar') {
      await tx.agendaItem.update({ where: { id: item.id }, data: { status: 'retirado' } })
      if (item.matterId) {
        await tx.legislativeMatter.update({
          where: { id: item.matterId },
          data: { status: 'retirado' },
        })
      }
      summary = `Item retirado da pauta${item.matterId ? ' (matéria marcada como retirada)' : ''}.`
      after = { status: 'retirado' }
    } else if (body.action === 'vista') {
      await tx.agendaItem.update({ where: { id: item.id }, data: { status: 'adiado' } })
      summary = `Pedido de vista registrado para "${item.title.slice(0, 60)}".`
      after = { status: 'adiado', incident: 'vista' }
    } else if (body.action === 'destaque') {
      summary = `Destaque regimental registrado em "${item.title.slice(0, 60)}".`
      after = { status: item.status, incident: 'destaque' }
    } else {
      // adiar
      await tx.agendaItem.update({ where: { id: item.id }, data: { status: 'adiado' } })
      summary = 'Item adiado para sessão futura.'
      after = { status: 'adiado' }
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: `agenda.${body.action}`,
      aggregateType: 'session',
      aggregateId: session.id,
      summary,
      before: { status: item.status, order: item.order },
      after,
      justification: body.justification ?? null,
      correlationId,
      ip: clientIp(req),
    })

    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'agenda.updated',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: session.version,
      correlationId,
      internalPayload: { sessionId: session.id },
      publicPayload: { sessionId: session.id },
    })

    return tx.agendaItem.findMany({
      where: { sessionId: session.id },
      orderBy: { order: 'asc' },
      include: { matter: true },
    })
  })

  return Response.json({ agenda: agenda.map(toAgendaItemView) })
})
