/** Read-only local-asset inventory for one tenant's pilot preflight. */
import { lstat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Prisma } from '@prisma/client'
import { isTenantImageUrl, parliamentarianImageRoot } from './parliamentarian-images'
import { verifyPrivateMatterAttachment } from './matter-attachment-private'

type Reader = Prisma.TransactionClient
type Roots = { images?: string; public?: string }

async function localFile(root: string, relative: string, size?: number): Promise<'ok' | 'missing' | 'invalid'> {
  if (!isAbsolute(root)) return 'invalid'
  const segments = relative.split('/')
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) return 'invalid'
  let path = resolve(root)
  try {
    if (!(await lstat(path)).isDirectory()) return 'invalid'
    for (const [index, segment] of segments.entries()) {
      path = join(path, segment)
      const entry = await lstat(path)
      if (entry.isSymbolicLink()) return 'invalid'
      if (index === segments.length - 1) {
        if (!entry.isFile() || (size && entry.size !== size)) return 'invalid'
      } else if (!entry.isDirectory()) return 'invalid'
    }
    return 'ok'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    return 'invalid'
  }
}

export async function inspectTenantAssetReferences(db: Reader, tenantId: string, roots: Roots = {}) {
  const [members, parties, attachments] = await Promise.all([
    db.parliamentarian.findMany({ where: { tenantId }, select: { photoUrl: true, partyEmblemUrl: true } }),
    db.party.findMany({ where: { tenantId }, select: { emblemUrl: true } }),
    db.matterAttachment.findMany({ where: { matter: { tenantId } },
      select: { url: true, sizeBytes: true, content: true, sha256: true, mimeType: true } }),
  ])
  const imageUrls = new Set([
    ...members.flatMap((person) => [person.photoUrl, person.partyEmblemUrl]),
    ...parties.map((party) => party.emblemUrl),
  ].filter((value): value is string => Boolean(value)))
  const imageRoot = roots.images ?? parliamentarianImageRoot()
  let imagesMissing = 0
  let imagesInvalid = 0
  for (const url of imageUrls) {
    if (!isTenantImageUrl(url, tenantId)) { imagesInvalid++; continue }
    const result = await localFile(imageRoot, `${tenantId}/${url.slice(url.lastIndexOf('/') + 1)}`)
    if (result === 'missing') imagesMissing++
    if (result === 'invalid') imagesInvalid++
  }

  let documentsMissing = 0
  let documentsInvalid = 0
  let documentsRemote = 0
  let documentsLocal = 0
  const publicRoot = roots.public ?? join(process.cwd(), 'public')
  for (const attachment of attachments) {
    if (attachment.content !== null || attachment.sha256 !== null) {
      try { verifyPrivateMatterAttachment(attachment); documentsLocal++ } catch { documentsInvalid++ }
      continue
    }
    const url = attachment.url
    if (!url) continue // metadado sem referência; tratado pelo fluxo documental
    if (/^https?:\/\//i.test(url)) { documentsRemote++; continue }
    if (!url.startsWith('/') || url.startsWith('//') || /[?#]/.test(url)) { documentsInvalid++; continue }
    let relative: string
    try { relative = decodeURIComponent(url.slice(1)) } catch { documentsInvalid++; continue }
    const result = await localFile(publicRoot, relative, attachment.sizeBytes)
    if (result === 'missing') documentsMissing++
    if (result === 'invalid') documentsInvalid++
    if (result === 'ok') documentsLocal++
  }
  return {
    images: imageUrls.size, imagesMissing, imagesInvalid,
    documentsLocal, documentsMissing, documentsInvalid, documentsRemote,
    ok: imagesMissing + imagesInvalid + documentsMissing + documentsInvalid === 0,
  }
}
