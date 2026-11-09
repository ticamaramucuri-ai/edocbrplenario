/** Read the issue/ACK state for a desktop's exact locally verified revision. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  const device = await authenticateLocalDeviceRequest(req, tenantId)
  const { id: sessionId } = await ctx.params
  const params = new URL(req.url).searchParams
  const revisionId = params.get('revisionId') ?? ''
  const manifestSha256 = params.get('manifestSha256') ?? ''
  if (!revisionId || revisionId.length > 200 || !/^[0-9a-f]{64}$/.test(manifestSha256)) {
    throw notFound('Emissão de pacote não encontrada para este desktop.')
  }
  const issue = await db.localSessionTransferIssue.findFirst({ where: {
    tenantId, deviceId: device.id, sessionId, revisionId, manifestSha256 },
    select: { id: true, revisionId: true, revisionNumber: true, manifestSha256: true,
      artifactHashesJson: true, acknowledgedAt: true },
  })
  if (!issue) throw notFound('Emissão de pacote não encontrada para este desktop.')
  return Response.json({ issueId: issue.id, revisionId: issue.revisionId,
    revisionNumber: issue.revisionNumber, manifestSha256: issue.manifestSha256,
    artifacts: JSON.parse(issue.artifactHashesJson), acknowledgedAt: issue.acknowledgedAt },
  { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
})
