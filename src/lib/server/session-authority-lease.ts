/** Transactional SaaS reservation for a signed local session authority epoch.
 * No route exposes this until web writers are fenced and local reconciliation exists.
 */
import { createPublicKey, type KeyObject } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { signSessionAuthorityGrant, verifySessionAuthorityGrant,
  type SignedSessionAuthorityGrant } from '@/lib/session-authority-contract'
import { DomainError } from './errors'
import { writeAudit } from './audit'

const LEASE_MS = 15 * 60_000
const RENEWAL_WINDOW_MS = 5 * 60_000
const RETRIES = 4
const MAX_EPOCH = 2_147_483_647

const precondition = (detail: string) => new DomainError('LOCAL_AUTHORITY_PRECONDITION', 409,
  'Concessão local indisponível', detail)
const conflict = (detail: string) => new DomainError('LOCAL_AUTHORITY_CONFLICT', 409,
  'Autoridade local ocupada', detail)

export async function reserveSessionAuthorityLease(args: {
  tenantId: string; sessionId: string; deviceId: string; revisionId: string; manifestSha256: string
  keyId: string; privateKey: KeyObject; correlationId: string; now?: Date
}): Promise<SignedSessionAuthorityGrant> {
  if (!args.tenantId || !args.sessionId || !args.deviceId || !args.revisionId ||
      [args.tenantId, args.sessionId, args.deviceId, args.revisionId, args.keyId].some((value) => value.length > 200) ||
      !/^[0-9a-f]{64}$/.test(args.manifestSha256) || !args.keyId || !args.correlationId ||
      args.privateKey.type !== 'private' || args.privateKey.asymmetricKeyType !== 'ed25519') {
    throw precondition('Escopo ou chave de assinatura inválidos.')
  }
  const now = args.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw precondition('Relógio do SaaS inválido.')

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: args.tenantId }, select: { active: true } })
        const session = await tx.session.findFirst({ where: { id: args.sessionId, tenantId: args.tenantId },
          select: { status: true, agendaPublished: true } })
        const designation = await tx.localServerDesignation.findUnique({ where: { tenantId: args.tenantId } })
        const device = await tx.localServerDevice.findFirst({ where: {
          id: args.deviceId, tenantId: args.tenantId, status: 'registered' }, select: { name: true } })
        if (!tenant?.active || !session || session.status !== 'scheduled' || !session.agendaPublished ||
            !device || designation?.deviceId !== args.deviceId) {
          throw precondition('Câmara, sessão publicada ou desktop designado não estão aptos.')
        }
        const latest = await tx.sessionAgendaRevision.findFirst({ where: {
          tenantId: args.tenantId, sessionId: args.sessionId }, orderBy: { revision: 'desc' }, select: { id: true } })
        if (latest?.id !== args.revisionId) throw precondition('A revisão importada não é a pauta publicada atual.')
        const receipt = await tx.localSessionTransferIssue.findFirst({ where: {
          tenantId: args.tenantId, sessionId: args.sessionId, deviceId: args.deviceId,
          revisionId: args.revisionId, manifestSha256: args.manifestSha256, acknowledgedAt: { not: null } },
          select: { id: true } })
        if (!receipt) throw precondition('Desktop não confirmou a importação integral deste manifesto.')

        const current = await tx.localSessionAuthorityLease.findUnique({ where: { sessionId: args.sessionId } })
        if (current && current.tenantId !== args.tenantId) throw precondition('Sessão pertence a outra Câmara.')
        if (current && current.expiresAt > now) {
          if (current.deviceId !== args.deviceId) throw conflict('Outra concessão ainda está válida; aguarde seu vencimento antes da troca.')
          if (current.revisionId !== args.revisionId || current.manifestSha256 !== args.manifestSha256) {
            throw conflict('Revisão mudou durante a concessão vigente; aguarde o vencimento antes de trocar o pacote.')
          }
          if (current.signingKeyId !== args.keyId) throw conflict('Chave de assinatura mudou durante a concessão vigente.')
          if (current.expiresAt.getTime() - now.getTime() > RENEWAL_WINDOW_MS) {
            const stored = JSON.parse(current.signedGrantJson) as SignedSessionAuthorityGrant
            verifySessionAuthorityGrant(stored, { tenantId: args.tenantId, sessionId: args.sessionId,
              deviceId: args.deviceId, revisionId: args.revisionId,
              manifestSha256: args.manifestSha256,
              trustedKeys: new Map([[args.keyId, createPublicKey(args.privateKey)]]), now,
              minimumEpoch: current.epoch })
            return stored
          }
        }
        if (current && current.epoch >= MAX_EPOCH) throw precondition('Época máxima atingida; intervenção operacional necessária.')
        const epoch = (current?.epoch ?? 0) + 1
        const expiresAt = new Date(now.getTime() + LEASE_MS)
        const signed = signSessionAuthorityGrant({ format: 'edocbr.session-authority', schemaVersion: 1,
          tenantId: args.tenantId, sessionId: args.sessionId, deviceId: args.deviceId,
          revisionId: args.revisionId, manifestSha256: args.manifestSha256,
          epoch, issuedAt: now.toISOString(), notBefore: now.toISOString(),
          expiresAt: expiresAt.toISOString() }, args.keyId, args.privateKey)
        const data = { tenantId: args.tenantId, deviceId: args.deviceId,
          revisionId: args.revisionId, manifestSha256: args.manifestSha256,
          epoch, issuedAt: now, expiresAt, signingKeyId: args.keyId, signedGrantJson: JSON.stringify(signed) }
        if (current) {
          const updated = await tx.localSessionAuthorityLease.updateMany({ where: {
            sessionId: args.sessionId, tenantId: args.tenantId, epoch: current.epoch }, data })
          if (updated.count !== 1) throw conflict('Concessão alterada concorrentemente; repita a operação.')
        } else {
          await tx.localSessionAuthorityLease.create({ data: { sessionId: args.sessionId, ...data } })
        }
        await writeAudit(tx, { tenantId: args.tenantId,
          actor: { name: device.name, role: 'local_server_device' },
          action: 'local_authority.reserved', aggregateType: 'session', aggregateId: args.sessionId,
          summary: 'Concessão local assinada reservada sem habilitar comandos oficiais.',
          before: current ? { deviceId: current.deviceId, epoch: current.epoch,
            expiresAt: current.expiresAt.toISOString() } : null,
          after: { deviceId: args.deviceId, revisionId: args.revisionId,
            manifestSha256: args.manifestSha256, epoch, expiresAt: expiresAt.toISOString() },
          correlationId: args.correlationId })
        return signed
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error &&
          (error.code === 'P2034' || error.code === 'P2002' || error.code === 'P1008') && attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
  throw conflict('Concessão alterada concorrentemente; repita a operação.')
}
