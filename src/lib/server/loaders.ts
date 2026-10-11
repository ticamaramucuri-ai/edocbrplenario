/**
 * Loaders com escopo de tenant: busca por id + assertTenantScope + 404.
 * NUNCA confia em tenantId do body — o escopo sempre deriva do ator.
 */
import { db } from '@/lib/db'
import { notFound } from './errors'
import { assertTenantScope, type ResolvedActor } from './actor'
import type { Session, AgendaItem, Voting, Speech, LegislativeMatter, Parliamentarian, Tenant, Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function loadSession(actor: ResolvedActor, id: string, client: Tx = db): Promise<Session> {
  const session = await client.session.findUnique({ where: { id } })
  if (!session) throw notFound('Sessão não encontrada.')
  assertTenantScope(actor, session.tenantId)
  return session
}

export async function loadAgendaItem(actor: ResolvedActor, itemId: string): Promise<AgendaItem> {
  const item = await db.agendaItem.findUnique({ where: { id: itemId } })
  if (!item) throw notFound('Item de pauta não encontrado.')
  const session = await db.session.findUnique({ where: { id: item.sessionId } })
  if (!session) throw notFound('Sessão do item de pauta não encontrada.')
  assertTenantScope(actor, session.tenantId)
  return item
}

export async function loadVoting(
  actor: ResolvedActor,
  id: string
): Promise<Voting & { session: Session }> {
  const voting = await db.voting.findUnique({ where: { id }, include: { session: true } })
  if (!voting) throw notFound('Votação não encontrada.')
  assertTenantScope(actor, voting.session.tenantId)
  return voting
}

export async function loadSpeech(actor: ResolvedActor, id: string): Promise<Speech & { session: Session }> {
  const speech = await db.speech.findUnique({ where: { id }, include: { session: true } })
  if (!speech) throw notFound('Discurso não encontrado.')
  assertTenantScope(actor, speech.session.tenantId)
  return speech
}

export async function loadMatter(actor: ResolvedActor, id: string): Promise<LegislativeMatter> {
  const matter = await db.legislativeMatter.findUnique({ where: { id } })
  if (!matter) throw notFound('Matéria não encontrada.')
  assertTenantScope(actor, matter.tenantId)
  return matter
}

export async function loadParliamentarian(actor: ResolvedActor, id: string): Promise<Parliamentarian> {
  const p = await db.parliamentarian.findUnique({ where: { id } })
  if (!p) throw notFound('Parlamentar não encontrado.')
  assertTenantScope(actor, p.tenantId)
  return p
}

export async function loadTenant(actor: ResolvedActor, id: string): Promise<Tenant> {
  const tenant = await db.tenant.findUnique({ where: { id } })
  if (!tenant) throw notFound('Tenant não encontrado.')
  assertTenantScope(actor, tenant.id)
  return tenant
}
