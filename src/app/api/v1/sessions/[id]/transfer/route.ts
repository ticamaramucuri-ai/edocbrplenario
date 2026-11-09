/** Signed preparation package for the one designated server of this Chamber. */
import type { NextRequest } from 'next/server'
import { apiHandler, DomainError, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'
import { issueSessionTransfer } from '@/lib/server/session-transfer-issuance'
import { transferPackageStream } from '@/lib/session-transfer-wire'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  const device = await authenticateLocalDeviceRequest(req, tenantId)
  const { id } = await ctx.params
  const candidate = await issueSessionTransfer({ tenantId, sessionId: id, deviceId: device.id })
  let stream: ReadableStream<Uint8Array>
  try { stream = transferPackageStream(candidate) }
  catch (error) {
    console.error('[session-transfer] package exceeds limits', error)
    throw new DomainError('SESSION_PRECONDITION', 409, 'Pacote excede o limite',
      'A preparação da sessão excede os limites de transferência local.')
  }
  return new Response(stream, { headers: {
    'Content-Type': 'application/vnd.edocbr.session-transfer.v1',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'attachment; filename="sessao-preparada.edocbr"',
    'X-Edocbr-Transfer-Issue-Id': candidate.issueId,
  } })
})
