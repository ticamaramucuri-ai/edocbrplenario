/** One exact artifact of an already issued revision, restricted to its desktop. */
import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'
import { buildSessionTransferCandidate } from '@/lib/server/session-transfer-export'
import { canonicalManifest } from '@/lib/session-transfer-contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
  let candidate: Awaited<ReturnType<typeof buildSessionTransferCandidate>>
  try { candidate = await buildSessionTransferCandidate({ tenantId, sessionId }) }
  catch {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Revisão indisponível',
      'A revisão desta emissão não está mais preparável.')
  }
  const digest = createHash('sha256').update(canonicalManifest(candidate.manifest)).digest('hex')
  const receipts = JSON.stringify(candidate.manifest.artifacts.map((item) => ({
    id: item.id, sha256: item.sha256, sizeBytes: item.sizeBytes })))
  if (issue.revisionId !== candidate.manifest.revisionId || issue.manifestSha256 !== digest ||
      issue.artifactHashesJson !== receipts) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Emissão obsoleta',
      'A pauta mudou; obtenha o novo manifesto antes de continuar.')
  }
  const artifact = candidate.manifest.artifacts.find((item) => item.id === artifactId)
  const bytes = candidate.bytesById.get(artifactId)
  if (!artifact || !bytes || bytes.byteLength !== artifact.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
    throw notFound('Artefato desta emissão não encontrado.')
  }
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
})
