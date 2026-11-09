/** Signed manifest and durable issue ID for per-artifact transfer. */
import type { NextRequest } from 'next/server'
import { apiHandler, DomainError, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'
import { issueSessionTransfer } from '@/lib/server/session-transfer-issuance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  const device = await authenticateLocalDeviceRequest(req, tenantId)
  const { id } = await ctx.params
  const issued = await issueSessionTransfer({ tenantId, sessionId: id, deviceId: device.id })
  const body = JSON.stringify({ issueId: issued.issueId, manifest: issued.manifest, signature: issued.signature })
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Manifesto excede o limite', 'Reduza os metadados da sessão.')
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
})
