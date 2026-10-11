/** Prévia e confirmação de uma emenda à pauta publicada, antes do credenciamento. */
import type { NextRequest } from 'next/server'
import type { AgendaItem, LegislativeMatter, Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { tenantSettings } from '@/lib/server/domain'
import { matterLabel } from '@/lib/server/serializers'
import { writeAudit } from '@/lib/server/audit'
import { emitOutbox } from '@/lib/server/outbox'

export const dynamic = 'force-dynamic'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), mode: z.enum(['preview', 'apply']), version: z.number().int().positive(), matterId: z.string().min(1), justification: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal('move'), mode: z.enum(['preview', 'apply']), version: z.number().int().positive(), itemId: z.string().min(1), position: z.number().int().min(0), justification: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal('retire'), mode: z.enum(['preview', 'apply']), version: z.number().int().positive(), itemId: z.string().min(1), justification: z.string().trim().min(3).max(2000) }),
])

type Command = z.infer<typeof schema>
type Tx = Prisma.TransactionClient
type SnapshotItem = Pick<AgendaItem, 'id' | 'order' | 'section' | 'matterId' | 'title' | 'kind' | 'batchItems' | 'status'>

const snapshot = (items: SnapshotItem[]) => items.map((item, order) => ({
  id: item.id, order, section: item.section, matterId: item.matterId,
  title: item.title, kind: item.kind, batchItems: item.batchItems, status: item.status,
}))

function plan(items: AgendaItem[], command: Command, matter: LegislativeMatter | null) {
  const before = snapshot(items)
  let after: SnapshotItem[] = [...items]
  let summary: string
  if (command.action === 'add') {
    if (!matter) throw notFound('Matéria não encontrada nesta Câmara.')
    if (!['em_tramitacao', 'incluida_pauta'].includes(matter.status)) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Matéria indisponível', 'A matéria não está em tramitação.')
    }
    if (items.some((item) => item.matterId === matter.id)) {
      throw new DomainError('VALIDATION_ERROR', 422, 'Matéria duplicada', 'A matéria já consta desta pauta.')
    }
    const title = `${matterLabel(matter)} — ${matter.ementa}`.slice(0, 120)
    const index = after.findIndex((item) => item.section === 'comunicacoes')
    const newItem = { id: `preview:${matter.id}`, order: -1, section: 'ordem_do_dia', matterId: matter.id,
      title, kind: 'individual', batchItems: null, status: 'pendente' }
    after.splice(index < 0 ? after.length : index, 0, newItem)
    summary = `Incluir ${matterLabel(matter)} na Ordem do Dia.`
  } else {
    const index = after.findIndex((item) => item.id === command.itemId)
    if (index < 0) throw notFound('Item de pauta não encontrado nesta sessão.')
    const item = after[index]
    if (item.section !== 'ordem_do_dia') {
      throw new DomainError('VALIDATION_ERROR', 422, 'Seção fixa', 'A emenda altera apenas matérias da Ordem do Dia.')
    }
    if (command.action === 'retire') {
      if (item.status === 'retirado') throw new DomainError('VALIDATION_ERROR', 422, 'Item retirado', 'A matéria já foi retirada.')
      after[index] = { ...item, status: 'retirado' }
      summary = `Retirar ${item.title} da pauta.`
    } else {
      const section = after.filter((row) => row.section === 'ordem_do_dia')
      if (command.position >= section.length) throw new DomainError('VALIDATION_ERROR', 422, 'Posição inválida', 'A posição excede o tamanho da Ordem do Dia.')
      if (item.status === 'retirado') throw new DomainError('VALIDATION_ERROR', 422, 'Item retirado', 'Não é possível mover um item retirado.')
      const sectionStart = after.findIndex((row) => row.section === 'ordem_do_dia')
      after.splice(index, 1)
      after.splice(sectionStart + command.position, 0, item)
      summary = `Mover ${item.title} para a posição ${command.position + 1} da Ordem do Dia.`
    }
  }
  const result = snapshot(after)
  if (JSON.stringify(before) === JSON.stringify(result)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Sem alteração', 'A emenda proposta não altera a pauta.')
  }
  return { before, after: result, summary }
}

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const command = schema.parse(await req.json())
  const session = await loadSession(actor, id)
  if (session.status !== 'scheduled' || !session.agendaPublished) {
    throw new DomainError('AGENDA_INVALID_STATE', 409, 'Pauta indisponível', 'Emendas são permitidas somente após publicar a pauta e antes do credenciamento.')
  }
  if (session.version !== command.version) {
    throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A sessão mudou. Recarregue a pauta antes de confirmar.')
  }
  const loadPlan = async (tx: Tx) => {
    const current = await tx.session.findFirst({ where: { id, tenantId: session.tenantId } })
    if (!current || current.status !== 'scheduled' || current.version !== command.version) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A sessão mudou. Recarregue a pauta antes de confirmar.')
    }
    const [items, matter, revision, tenant] = await Promise.all([
      tx.agendaItem.findMany({ where: { sessionId: id }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
      command.action === 'add' ? tx.legislativeMatter.findFirst({ where: { id: command.matterId, tenantId: session.tenantId } }) : Promise.resolve(null),
      tx.sessionAgendaRevision.findFirst({ where: { sessionId: id, tenantId: session.tenantId }, orderBy: { revision: 'desc' } }),
      tx.tenant.findUnique({ where: { id: session.tenantId } }),
    ])
    if (!revision || !tenant) throw new DomainError('SESSION_PRECONDITION', 409, 'Publicação ausente', 'Não há revisão inicial registrada para esta pauta.')
    const change = plan(items, command, matter)
    const policy = tenantSettings(tenant)
    const activeMatters = change.after.filter((item) => item.section === 'ordem_do_dia' && item.matterId && !['retirado', 'adiado'].includes(item.status)).length
    if (activeMatters < policy.minimumAgendaMatters) {
      throw new DomainError('SESSION_PRECONDITION', 409, 'Pauta incompleta', `Esta Câmara exige ao menos ${policy.minimumAgendaMatters} matéria(s) na Ordem do Dia.`)
    }
    return { ...change, revision: revision.revision + 1, policy }
  }

  if (command.mode === 'preview') {
    return Response.json({ preview: await db.$transaction(loadPlan) })
  }
  const result = await withTransaction(async (tx) => {
    const change = await loadPlan(tx)
    if (command.action === 'add') {
      const newItem = change.after.find((item) => item.id === `preview:${command.matterId}`)!
      const created = await tx.agendaItem.create({ data: { sessionId: id, order: newItem.order, section: 'ordem_do_dia', title: newItem.title, matterId: command.matterId, kind: 'individual', status: 'pendente' } })
      change.after = change.after.map((item) => item.id === newItem.id ? { ...item, id: created.id } : item)
      await tx.legislativeMatter.update({ where: { id: command.matterId }, data: { status: 'incluida_pauta' } })
    } else if (command.action === 'retire') {
      await tx.agendaItem.update({ where: { id: command.itemId }, data: { status: 'retirado' } })
    }
    for (const item of change.after) {
      await tx.agendaItem.update({ where: { id: item.id }, data: { order: item.order } })
    }
    const changed = await tx.session.updateMany({ where: { id, tenantId: session.tenantId, status: 'scheduled', version: command.version }, data: { version: { increment: 1 } } })
    if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Conflito de versão', 'A sessão mudou. Recarregue a pauta.')
    await tx.sessionAgendaRevision.create({ data: {
      tenantId: session.tenantId, sessionId: id, revision: change.revision,
      agendaJson: JSON.stringify(change.after),
      policyJson: JSON.stringify({ enabledSessionTypes: change.policy.enabledSessionTypes, requireSecretaryForPublication: change.policy.requireSecretaryForPublication, minimumAgendaMatters: change.policy.minimumAgendaMatters }),
      changeJson: JSON.stringify({ action: command.action, before: change.before, after: change.after }),
      justification: command.justification, actorId: actor.id,
    } })
    await writeAudit(tx, { tenantId: session.tenantId, actor, action: 'agenda.amended', aggregateType: 'session', aggregateId: id,
      summary: `${change.summary} Revisão ${change.revision}.`, before: { revision: change.revision - 1 }, after: { revision: change.revision, action: command.action },
      justification: command.justification, correlationId, ip: clientIp(req) })
    await emitOutbox(tx, { tenantId: session.tenantId, eventType: 'agenda.updated', aggregateId: id, sessionId: id,
      aggregateVersion: command.version + 1, correlationId,
      internalPayload: { sessionId: id, revision: change.revision }, publicPayload: { sessionId: id, revision: change.revision } })
    return change
  })
  return Response.json({ amendment: result }, { status: 201 })
})
