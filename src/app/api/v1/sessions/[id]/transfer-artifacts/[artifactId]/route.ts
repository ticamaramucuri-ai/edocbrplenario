/** One exact artifact of an already issued revision, restricted to its desktop. */
import { createHash } from 'node:crypto'
import { Prisma, type LocalSessionTransferIssue } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'
import { buildSessionTransferCandidate } from '@/lib/server/session-transfer-export'
import { canonicalManifest, transferManifestV1Schema, type TransferManifestV1 } from '@/lib/session-transfer-contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const unavailable = () => new DomainError('SESSION_PRECONDITION', 409, 'Revisão indisponível',
  'A revisão desta emissão não está mais preparável.')
const obsolete = () => new DomainError('SESSION_PRECONDITION', 409, 'Emissão obsoleta',
  'A pauta mudou; obtenha o novo manifesto antes de continuar.')

function issuedManifest(issue: LocalSessionTransferIssue, tenantId: string, sessionId: string): TransferManifestV1 {
  let manifest: TransferManifestV1
  try { manifest = transferManifestV1Schema.parse(JSON.parse(issue.manifestJson!)) }
  catch { throw obsolete() }
  if (manifest.tenantId !== tenantId || manifest.sessionId !== sessionId ||
      manifest.revisionId !== issue.revisionId || manifest.revisionNumber !== issue.revisionNumber ||
      sha256(canonicalManifest(manifest)) !== issue.manifestSha256 ||
      JSON.stringify(manifest.artifacts.map((item) => ({ id: item.id, sha256: item.sha256,
        sizeBytes: item.sizeBytes }))) !== issue.artifactHashesJson) throw obsolete()
  return manifest
}

async function readSelectedArtifact(args: { issue: LocalSessionTransferIssue; tenantId: string;
  sessionId: string; artifactId: string }): Promise<Uint8Array> {
  const manifest = issuedManifest(args.issue, args.tenantId, args.sessionId)
  const artifact = manifest.artifacts.find((item) => item.id === args.artifactId)
  if (!artifact) throw notFound('Artefato desta emissão não encontrado.')
  if (artifact.sizeBytes > 50 * 1024 * 1024) throw unavailable()
  return db.$transaction(async (tx) => {
    const session = await tx.session.findFirst({ where: { id: args.sessionId, tenantId: args.tenantId },
      select: { status: true, agendaPublished: true } })
    if (!session || session.status !== 'scheduled' || !session.agendaPublished) throw unavailable()
    const revision = await tx.sessionAgendaRevision.findFirst({ where: {
      tenantId: args.tenantId, sessionId: args.sessionId }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (revision?.id !== args.issue.revisionId) throw obsolete()
    const source = artifact.source === 'session_document'
      ? await tx.sessionDocument.findFirst({ where: { id: artifact.sourceId, tenantId: args.tenantId,
        sessionId: args.sessionId }, select: { name: true, mimeType: true, sizeBytes: true,
        sha256: true, content: true } })
      : await tx.sessionMatterArtifact.findFirst({ where: { tenantId: args.tenantId,
        revisionId: revision.id, attachmentId: artifact.sourceId }, select: { name: true,
        mimeType: true, sizeBytes: true, sha256: true, content: true } })
    if (!source || source.name !== artifact.name || source.mimeType !== artifact.mimeType ||
        source.sizeBytes !== artifact.sizeBytes || source.sha256 !== artifact.sha256 ||
        source.content.byteLength !== artifact.sizeBytes || sha256(source.content) !== artifact.sha256) {
      throw unavailable()
    }
    return source.content
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  const device = await authenticateLocalDeviceRequest(req, tenantId)
  const { id: sessionId, artifactId } = await ctx.params
  const issueId = new URL(req.url).searchParams.get('issueId') ?? ''
  if (!issueId || issueId.length > 200 || !artifactId || artifactId.length > 200) {
    throw notFound('Artefato desta emissão não encontrado.')
  }
  const issue = await db.localSessionTransferIssue.findFirst({ where: {
    id: issueId, tenantId, deviceId: device.id, sessionId },
  })
  if (!issue) throw notFound('Artefato desta emissão não encontrado.')
  let bytes: Uint8Array
  if (issue.manifestJson) {
    bytes = await readSelectedArtifact({ issue, tenantId, sessionId, artifactId })
  } else {
    // Existing issues created before migration 0025 retain the full-package check.
    let candidate: Awaited<ReturnType<typeof buildSessionTransferCandidate>>
    try { candidate = await buildSessionTransferCandidate({ tenantId, sessionId }) }
    catch { throw unavailable() }
    const receipts = JSON.stringify(candidate.manifest.artifacts.map((item) => ({
      id: item.id, sha256: item.sha256, sizeBytes: item.sizeBytes })))
    if (issue.revisionId !== candidate.manifest.revisionId ||
        issue.manifestSha256 !== sha256(canonicalManifest(candidate.manifest)) ||
        issue.artifactHashesJson !== receipts) throw obsolete()
    const artifact = candidate.manifest.artifacts.find((item) => item.id === artifactId)
    const selected = candidate.bytesById.get(artifactId)
    if (!artifact || !selected || selected.byteLength !== artifact.sizeBytes ||
        sha256(selected) !== artifact.sha256) throw notFound('Artefato desta emissão não encontrado.')
    bytes = selected
  }
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
})
