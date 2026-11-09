import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { transferManifestV1Schema } from '@/lib/session-transfer-contract'
import { tenantSettings } from './domain'

const transferContextSchema = transferManifestV1Schema.pick({
  sessionVersion: true,
  officialConfigurationId: true,
  deliberationPolicySnapshot: true,
  rosterSnapshot: true,
}).extend({ version: z.literal(1) }).strict()

export type FrozenTransferContext = z.infer<typeof transferContextSchema>

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Snapshot institucional incompleto.')
  return value as Record<string, unknown>
}

/** Capture the roster, deliberation policy and session version in the publication transaction. */
export async function freezeTransferContext(tx: Prisma.TransactionClient, args: {
  tenantId: string; sessionId: string; revisionId: string
}): Promise<void> {
  const revision = await tx.sessionAgendaRevision.findFirst({ where: {
    id: args.revisionId, tenantId: args.tenantId, sessionId: args.sessionId,
  } })
  const session = await tx.session.findFirst({ where: { id: args.sessionId, tenantId: args.tenantId } })
  const tenant = await tx.tenant.findUnique({ where: { id: args.tenantId } })
  if (!revision || !session || !tenant || session.status !== 'scheduled' || !session.agendaPublished) {
    throw new Error('Revisão, sessão publicada ou Câmara ausente para congelamento.')
  }
  if (revision.transferContextJson) throw new Error('Contexto de transferência da revisão já foi congelado.')

  let roster: FrozenTransferContext['rosterSnapshot']
  let settingsSource = tenant.settings
  if (session.official) {
    if (!session.officialConfigurationId) throw new Error('Sessão oficial sem configuração aprovada.')
    const approved = await tx.officialConfigurationRevision.findFirst({ where: {
      id: session.officialConfigurationId, tenantId: args.tenantId,
    } })
    if (!approved || sha256(approved.snapshotJson) !== approved.snapshotSha256) {
      throw new Error('Configuração oficial ausente ou com hash divergente.')
    }
    const snapshot = object(JSON.parse(approved.snapshotJson))
    const approvedTenant = object(snapshot.tenant)
    const people = snapshot.parliamentarians
    const positions = snapshot.boardPositions
    if (typeof approvedTenant.settings !== 'string' || !Array.isArray(people) || !Array.isArray(positions)) {
      throw new Error('Snapshot institucional incompleto.')
    }
    settingsSource = approvedTenant.settings
    roster = people.map((value) => {
      const person = object(value)
      const position = positions.map(object).find((item) => item.parliamentarianId === person.id && item.status === 'confirmed')
      return { parliamentarianId: person.id, displayName: person.name, party: person.party,
        active: person.active, boardRole: position?.role ?? null }
    }) as FrozenTransferContext['rosterSnapshot']
  } else {
    const people = await tx.parliamentarian.findMany({ where: { tenantId: args.tenantId }, orderBy: { id: 'asc' } })
    roster = people.map((person) => ({ parliamentarianId: person.id,
      displayName: person.displayName || person.name, party: person.party, active: person.active,
      boardRole: person.boardRole }))
  }

  const context = transferContextSchema.parse({
    version: 1,
    sessionVersion: session.version,
    officialConfigurationId: session.officialConfigurationId,
    deliberationPolicySnapshot: tenantSettings({ settings: settingsSource }, roster.filter((person) => person.active).length),
    rosterSnapshot: roster,
  })
  await tx.sessionAgendaRevision.update({ where: { id: revision.id }, data: { transferContextJson: JSON.stringify(context) } })
}

export function readTransferContext(raw: string | null): FrozenTransferContext {
  if (!raw) throw new Error('Revisão legada sem contexto de transferência; publique nova revisão antes da preparação local.')
  try { return transferContextSchema.parse(JSON.parse(raw)) } catch {
    throw new Error('Contexto de transferência da revisão inválido.')
  }
}
