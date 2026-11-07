/** Read-only candidate for a future authenticated web → local transfer.
 * No route, signing key, device grant or offline authority is exposed here.
 */
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { tenantSettings } from './domain'
import type { TransferManifestV1 } from '@/lib/session-transfer-contract'

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
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

async function localAttachmentBytes(url: string | null, publicRoot: string, tenantId: string): Promise<Uint8Array> {
  if (!url || !url.startsWith('/') || url.startsWith('//') || /[?#\\]/.test(url)) {
    throw new Error('Anexo sem cópia local verificável; URL externa bloqueia exportação.')
  }
  if (!isAbsolute(publicRoot)) throw new Error('Raiz pública deve ser absoluta.')
  const root = await realpath(publicRoot)
  if (!(await lstat(publicRoot)).isDirectory()) throw new Error('Raiz pública inválida.')
  let relative: string
  try { relative = decodeURIComponent(url.slice(1)) } catch { throw new Error('URL de anexo inválida.') }
  const parts = relative.split('/')
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('Caminho de anexo inválido.')
  }
  if (parts.length < 3 || parts[0] !== 'tenants' || parts[1] !== tenantId) {
    throw new Error('Anexo fora do espaço de arquivos desta Câmara.')
  }
  let path = root
  for (const part of parts) {
    path = join(path, part)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlink proibido no anexo.')
  }
  const resolved = await realpath(path)
  const leaf = await lstat(path)
  if (!resolved.startsWith(root + sep) || !leaf.isFile()) throw new Error('Anexo fora da raiz pública.')
  if (leaf.size === 0 || leaf.size > MAX_ATTACHMENT_BYTES) throw new Error('Tamanho de anexo fora do limite do exportador inicial.')
  const content = await readFile(path)
  if (content.length !== leaf.size) throw new Error('Anexo mudou durante a leitura.')
  return content
}

export type SessionTransferCandidate = {
  manifest: TransferManifestV1
  bytesById: Map<string, Uint8Array>
}

/** Build only the latest published revision, scoped by explicit tenant ID. */
export async function buildSessionTransferCandidate(args: {
  tenantId: string
  sessionId: string
  publicRoot: string
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
          document.name !== reference.name || document.sizeBytes !== reference.sizeBytes || document.sha256 !== reference.sha256 ||
          document.content.length !== document.sizeBytes || sha256(document.content) !== document.sha256) {
        throw new Error('Documento diverge da revisão publicada.')
      }
      const id = `session-document:${document.id}`
      bytesById.set(id, document.content)
      artifacts.push({ id, source: 'session_document', sourceId: document.id, name: document.name,
        mimeType: document.mimeType, sizeBytes: document.sizeBytes, sha256: document.sha256 })
    }

    const matterIds = [...new Set(agenda.map((item) => item.matterId).filter((id): id is string => typeof id === 'string' && id.length > 0))]
    const matters = await tx.legislativeMatter.findMany({ where: { tenantId: args.tenantId, id: { in: matterIds } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 }, attachments: { orderBy: { id: 'asc' } } } })
    if (matters.length !== matterIds.length) throw new Error('Matéria da pauta ausente nesta Câmara.')
    const mattersById = new Map(matters.map((matter) => [matter.id, matter]))
    const matterSnapshot: TransferManifestV1['matterSnapshot'] = []
    for (const matterId of matterIds) {
      const matter = mattersById.get(matterId)!
      const authors: unknown = JSON.parse(matter.authors)
      if (!Array.isArray(authors) || authors.some((author) => typeof author !== 'string')) throw new Error('Autores da matéria inválidos.')
      if (matter.versions.length === 0 && matter.attachments.length === 0) throw new Error('Matéria sem texto ou anexo integral para uso local.')
      matterSnapshot.push({ matterId, type: matter.type, number: matter.number, year: matter.year,
        ementa: matter.ementa, authors, latestVersion: matter.versions[0]?.version ?? null,
        latestText: matter.versions[0]?.text ?? null })
      for (const attachment of matter.attachments) {
        const content = await localAttachmentBytes(attachment.url, args.publicRoot, args.tenantId)
        if (content.byteLength !== attachment.sizeBytes) throw new Error('Anexo diverge do tamanho cadastrado.')
        const id = `matter-attachment:${attachment.id}`
        bytesById.set(id, content)
        artifacts.push({ id, source: 'matter_attachment', sourceId: attachment.id,
          name: attachment.name, mimeType: 'application/octet-stream',
          sizeBytes: content.byteLength, sha256: sha256(content) })
      }
    }

    const tenant = await tx.tenant.findUnique({ where: { id: args.tenantId } })
    if (!tenant) throw new Error('Câmara ausente.')
    let roster: TransferManifestV1['rosterSnapshot']
    let settingsSource = tenant.settings
    if (session.official) {
      if (!session.officialConfigurationId) throw new Error('Sessão oficial sem configuração aprovada.')
      const approved = await tx.officialConfigurationRevision.findFirst({
        where: { id: session.officialConfigurationId, tenantId: args.tenantId },
      })
      if (!approved || sha256(Buffer.from(approved.snapshotJson)) !== approved.snapshotSha256) {
        throw new Error('Configuração oficial ausente ou com hash divergente.')
      }
      const snapshot = jsonObject(approved.snapshotJson, 'Configuração oficial')
      const approvedTenant = snapshot.tenant as Record<string, unknown> | undefined
      const people = snapshot.parliamentarians as Array<Record<string, unknown>> | undefined
      const positions = snapshot.boardPositions as Array<Record<string, unknown>> | undefined
      if (!approvedTenant || typeof approvedTenant.settings !== 'string' || !Array.isArray(people) || !Array.isArray(positions)) {
        throw new Error('Snapshot institucional incompleto.')
      }
      settingsSource = approvedTenant.settings
      roster = people.map((person) => ({ parliamentarianId: String(person.id), displayName: String(person.name),
        party: String(person.party), active: person.active === true,
        boardRole: String(positions.find((position) => position.parliamentarianId === person.id && position.status === 'confirmed')?.role ?? '') || null }))
    } else {
      const people = await tx.parliamentarian.findMany({ where: { tenantId: args.tenantId }, orderBy: { id: 'asc' } })
      roster = people.map((person) => ({ parliamentarianId: person.id,
        displayName: person.displayName || person.name, party: person.party, active: person.active,
        boardRole: person.boardRole }))
    }
    const deliberationPolicySnapshot = { ...tenantSettings({ settings: settingsSource }, roster.filter((person) => person.active).length) }
    const manifest: TransferManifestV1 = {
      format: 'edocbr.session-transfer', schemaVersion: 1,
      tenantId: args.tenantId, sessionId: session.id, revisionId: revision.id,
      revisionNumber: revision.revision, sessionVersion: session.version,
      officialConfigurationId: session.officialConfigurationId, createdAt: revision.createdAt.toISOString(),
      agendaSnapshot: agenda, policySnapshot: policy, deliberationPolicySnapshot,
      matterSnapshot, rosterSnapshot: roster, artifacts,
    }
    return { manifest, bytesById }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}
