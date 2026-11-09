/** Read-only candidate for authenticated web → local preparation.
 * This builder does not grant session or voting authority.
 */
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { readTransferContext } from './session-transfer-context'
import type { MatterManifest } from './session-matter-snapshot'
import type { TransferManifestV1 } from '@/lib/session-transfer-contract'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function jsonObject(raw: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} não é objeto JSON.`)
  return value as Record<string, unknown>
}

function jsonArray(raw: string, label: string): Array<Record<string, unknown>> {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${label} não é lista JSON de objetos.`)
  }
  return value as Array<Record<string, unknown>>
}

export type SessionTransferCandidate = {
  manifest: TransferManifestV1
  bytesById: Map<string, Uint8Array>
}

/** Build only the latest published revision, scoped by explicit tenant ID. */
export async function buildSessionTransferCandidate(args: {
  tenantId: string
  sessionId: string
}): Promise<SessionTransferCandidate> {
  return db.$transaction(async (tx) => {
    const session = await tx.session.findFirst({ where: { id: args.sessionId, tenantId: args.tenantId } })
    if (!session) throw new Error('Sessão não encontrada nesta Câmara.')
    if (session.status !== 'scheduled' || !session.agendaPublished) {
      throw new Error('Somente sessão com pauta publicada e ainda não aberta pode ser preparada localmente.')
    }
    const revision = await tx.sessionAgendaRevision.findFirst({
      where: { tenantId: args.tenantId, sessionId: session.id }, orderBy: { revision: 'desc' },
    })
    if (!revision) throw new Error('Revisão publicada ausente.')
    const agenda = jsonArray(revision.agendaJson, 'Pauta')
    const policy = jsonObject(revision.policyJson, 'Política de preparação')
    const documentReferences = jsonArray(revision.documentManifestJson, 'Manifesto de documentos')
    const documentIds = documentReferences.map((item) => item.id)
    if (documentIds.some((id) => typeof id !== 'string') || new Set(documentIds).size !== documentIds.length) {
      throw new Error('Manifesto de documentos contém ID ausente ou repetido.')
    }
    const documents = await tx.sessionDocument.findMany({
      where: { tenantId: args.tenantId, sessionId: session.id, id: { in: documentIds as string[] } },
    })
    if (documents.length !== documentReferences.length) throw new Error('Documento publicado ausente nesta Câmara.')
    const documentsById = new Map(documents.map((document) => [document.id, document]))
    const bytesById = new Map<string, Uint8Array>()
    const artifacts: TransferManifestV1['artifacts'] = []
    for (const reference of documentReferences) {
      const document = documentsById.get(reference.id as string)
      if (!document || document.kind !== reference.kind || document.version !== reference.version ||
          document.name !== reference.name || document.mimeType !== reference.mimeType ||
          document.sizeBytes !== reference.sizeBytes || document.sha256 !== reference.sha256 ||
          document.content.length !== document.sizeBytes || sha256(document.content) !== document.sha256) {
        throw new Error('Documento diverge da revisão publicada.')
      }
      const id = `session-document:${document.id}`
      bytesById.set(id, document.content)
      artifacts.push({ id, source: 'session_document', sourceId: document.id, name: document.name,
        mimeType: document.mimeType, sizeBytes: document.sizeBytes, sha256: document.sha256 })
    }

    if (!revision.matterManifestJson) throw new Error('Revisão legada sem snapshot de matérias; publique nova revisão antes da preparação local.')
    const frozen = jsonObject(revision.matterManifestJson, 'Snapshot de matérias') as unknown as MatterManifest
    if (frozen.version !== 1 || !Array.isArray(frozen.matters) || !Array.isArray(frozen.unavailableAttachmentIds)) {
      throw new Error('Snapshot de matérias inválido.')
    }
    if (frozen.unavailableAttachmentIds.length) throw new Error('Revisão possui anexo sem bytes verificáveis; publique nova revisão após materialização.')
    const matterIds = [...new Set(agenda.map((item) => item.matterId).filter((id): id is string => typeof id === 'string' && id.length > 0))]
    if (frozen.matters.length !== matterIds.length || frozen.matters.some((item, index) => item.matterId !== matterIds[index])) {
      throw new Error('Snapshot de matérias diverge da pauta publicada.')
    }
    const frozenArtifacts = await tx.sessionMatterArtifact.findMany({ where: { tenantId: args.tenantId, revisionId: revision.id } })
    const artifactsByAttachmentId = new Map(frozenArtifacts.map((item) => [item.attachmentId, item]))
    const matterSnapshot: TransferManifestV1['matterSnapshot'] = []
    const referencedAttachmentIds = new Set<string>()
    for (const matter of frozen.matters) {
      if (!matter || !Array.isArray(matter.authors) || matter.authors.some((author) => typeof author !== 'string') ||
          !Array.isArray(matter.attachmentIds) || matter.attachmentIds.some((id) => typeof id !== 'string')) {
        throw new Error('Snapshot de matéria inválido.')
      }
      if (matter.latestText === null && matter.attachmentIds.length === 0) throw new Error('Matéria sem texto ou anexo integral para uso local.')
      matterSnapshot.push({ matterId: matter.matterId, type: matter.type, number: matter.number, year: matter.year,
        ementa: matter.ementa, authors: matter.authors, latestVersion: matter.latestVersion, latestText: matter.latestText })
      for (const attachmentId of matter.attachmentIds) {
        if (referencedAttachmentIds.has(attachmentId)) throw new Error('Anexo repetido no snapshot.')
        referencedAttachmentIds.add(attachmentId)
        const attachment = artifactsByAttachmentId.get(attachmentId)
        if (!attachment || attachment.content.length !== attachment.sizeBytes || sha256(attachment.content) !== attachment.sha256) {
          throw new Error('Anexo congelado ausente ou com hash divergente.')
        }
        const id = `matter-attachment:${attachmentId}`
        bytesById.set(id, attachment.content)
        artifacts.push({ id, source: 'matter_attachment', sourceId: attachmentId,
          name: attachment.name, mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes, sha256: attachment.sha256 })
      }
    }
    if (referencedAttachmentIds.size !== frozenArtifacts.length) throw new Error('Snapshot contém anexo extra.')

    const context = readTransferContext(revision.transferContextJson)
    const manifest: TransferManifestV1 = {
      format: 'edocbr.session-transfer', schemaVersion: 1,
      tenantId: args.tenantId, sessionId: session.id, revisionId: revision.id,
      revisionNumber: revision.revision, sessionVersion: context.sessionVersion,
      officialConfigurationId: context.officialConfigurationId, createdAt: revision.createdAt.toISOString(),
      agendaSnapshot: agenda, policySnapshot: policy, deliberationPolicySnapshot: context.deliberationPolicySnapshot,
      matterSnapshot, rosterSnapshot: context.rosterSnapshot, artifacts,
    }
    return { manifest, bytesById }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}
