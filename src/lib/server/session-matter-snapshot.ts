import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import type { Prisma } from '@prisma/client'

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export type FrozenMatter = {
  matterId: string
  type: string
  number: number
  year: number
  ementa: string
  authors: string[]
  latestVersion: number | null
  latestText: string | null
  attachmentIds: string[]
}

export type MatterManifest = {
  version: 1
  matters: FrozenMatter[]
  unavailableAttachmentIds: string[]
}

export async function localAttachmentBytes(url: string | null, publicRoot: string, tenantId: string): Promise<Uint8Array> {
  if (!url || !url.startsWith('/') || url.startsWith('//') || /[?#\\]/.test(url)) {
    throw new Error('Anexo sem cópia local verificável; URL externa bloqueia preparação local.')
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
  if (leaf.size === 0 || leaf.size > MAX_ATTACHMENT_BYTES) throw new Error('Tamanho de anexo fora do limite.')
  const content = await readFile(path)
  if (content.length !== leaf.size) throw new Error('Anexo mudou durante a leitura.')
  return content
}

export async function captureMatterSnapshot(tx: Prisma.TransactionClient, args: {
  tenantId: string
  agenda: Array<{ matterId?: string | null }>
  publicRoot: string
}): Promise<{ manifest: MatterManifest; artifacts: Array<{
  tenantId: string; attachmentId: string; name: string; mimeType: string;
  sizeBytes: number; sha256: string; content: Uint8Array
}> }> {
  const ids = [...new Set(args.agenda.map((item) => item.matterId).filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const matters = await tx.legislativeMatter.findMany({ where: { tenantId: args.tenantId, id: { in: ids } },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 }, attachments: { orderBy: { id: 'asc' } } } })
  if (matters.length !== ids.length) throw new Error('Matéria da pauta ausente nesta Câmara.')
  const byId = new Map(matters.map((matter) => [matter.id, matter]))
  const manifest: MatterManifest = { version: 1, matters: [], unavailableAttachmentIds: [] }
  const artifacts: Array<{ tenantId: string; attachmentId: string; name: string; mimeType: string;
    sizeBytes: number; sha256: string; content: Uint8Array }> = []
  for (const matterId of ids) {
    const matter = byId.get(matterId)!
    const authors: unknown = JSON.parse(matter.authors)
    if (!Array.isArray(authors) || authors.some((author) => typeof author !== 'string')) throw new Error('Autores da matéria inválidos.')
    manifest.matters.push({ matterId, type: matter.type, number: matter.number, year: matter.year,
      ementa: matter.ementa, authors, latestVersion: matter.versions[0]?.version ?? null,
      latestText: matter.versions[0]?.text ?? null, attachmentIds: matter.attachments.map((item) => item.id) })
    for (const attachment of matter.attachments) {
      try {
        const content = await localAttachmentBytes(attachment.url, args.publicRoot, args.tenantId)
        if (content.byteLength !== attachment.sizeBytes) throw new Error('Tamanho cadastrado diverge.')
        artifacts.push({ tenantId: args.tenantId, attachmentId: attachment.id, name: attachment.name,
          mimeType: 'application/octet-stream', sizeBytes: content.byteLength, sha256: sha256(content), content })
      } catch {
        // A pauta pode ser publicada; a preparação local ficará bloqueada até nova revisão íntegra.
        manifest.unavailableAttachmentIds.push(attachment.id)
      }
    }
  }
  return { manifest, artifacts }
}

export async function freezeMatterSnapshot(tx: Prisma.TransactionClient, args: {
  revisionId: string; tenantId: string; agenda: Array<{ matterId?: string | null }>; publicRoot: string
}): Promise<void> {
  const snapshot = await captureMatterSnapshot(tx, args)
  await tx.sessionAgendaRevision.update({ where: { id: args.revisionId },
    data: { matterManifestJson: JSON.stringify(snapshot.manifest) } })
  if (snapshot.artifacts.length) await tx.sessionMatterArtifact.createMany({ data: snapshot.artifacts.map((item) => ({ ...item, content: Buffer.from(item.content), revisionId: args.revisionId })) })
}
