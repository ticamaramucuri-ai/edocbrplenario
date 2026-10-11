/**
 * POST /api/v1/sessions/:id/agenda — adiciona matérias à ordem do dia
 * (somente sessões em draft; após publicação exige fluxo de alteração versionada). Atualiza matérias para
 * incluida_pauta, audita e emite `agenda.updated`.
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
import { matterLabel, toAgendaItemView } from '@/lib/server/serializers'
import { SESSION_STATUS_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  matterIds: z.array(z.string().min(1)).min(1, 'Informe ao menos uma matéria.'),
})

const truncate = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  // Adicionar matéria à pauta altera a tramitação da matéria → matter.write
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, id)
  if (session.status !== 'draft') {
    throw new DomainError(
      'AGENDA_INVALID_STATE',
      409,
      'Pauta indisponível',
      `Novas matérias só podem ser adicionadas ao rascunho. Após publicar, use o fluxo de alteração de pauta — status atual: ${SESSION_STATUS_LABEL[session.status as keyof typeof SESSION_STATUS_LABEL] ?? session.status}.`
    )
  }

  const matters = await db.legislativeMatter.findMany({
    where: { tenantId: session.tenantId, id: { in: body.matterIds } },
  })
  if (matters.length !== body.matterIds.length) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Uma ou mais matérias não foram encontradas neste tenant.',
      { errors: { matterIds: ['Matéria(s) inexistente(s) no escopo do tenant.'] } }
    )
  }

  const agenda = await withTransaction(async (tx) => {
    const last = await tx.agendaItem.findFirst({
      where: { sessionId: session.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    })
    let order = (last?.order ?? -1) + 1
    const created: Array<{ id: string }> = []
    for (const matterId of body.matterIds) {
      const matter = matters.find((m) => m.id === matterId)!
      const item = await tx.agendaItem.create({
        data: {
          sessionId: session.id,
          order: order++,
          section: 'ordem_do_dia',
          title: truncate(`${matterLabel(matter)} — ${matter.ementa}`),
          matterId: matter.id,
          kind: 'individual',
          status: 'pendente',
        },
      })
      created.push(item)
    }
    await tx.legislativeMatter.updateMany({
      where: { id: { in: body.matterIds } },
      data: { status: 'incluida_pauta' },
    })

    await writeAudit(tx, {
      tenantId: session.tenantId,
      actor,
      action: 'agenda.updated',
      aggregateType: 'session',
      aggregateId: session.id,
      summary: `${created.length} matéria(s) adicionada(s) à ordem do dia.`,
      after: { addedMatterIds: body.matterIds },
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
