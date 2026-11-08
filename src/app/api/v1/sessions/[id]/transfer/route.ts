/** Signed preparation package for the one designated server of this Chamber. */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'
import { buildSessionTransferCandidate } from '@/lib/server/session-transfer-export'
import { signSessionTransferCandidate } from '@/lib/server/session-transfer-signing'
import { transferPackageStream } from '@/lib/session-transfer-wire'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  const device = await authenticateLocalDeviceRequest(req, tenantId)
  const { id } = await ctx.params
  const session = await db.session.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!session) throw notFound('Sessão não encontrada nesta Câmara.')

  let candidate: Awaited<ReturnType<typeof buildSessionTransferCandidate>>
  try { candidate = await buildSessionTransferCandidate({ tenantId, sessionId: id }) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error
    console.error('[session-transfer] preparation failed', error)
    throw new DomainError('SESSION_PRECONDITION', 409, 'Sessão ainda não preparável',
      'Publique uma revisão completa da pauta, matérias e documentos antes de transferir.')
  }
  const root = process.env.EDOCBR_TRANSFER_KEY_ROOT
  if (!root) throw new DomainError('LOCAL_TRANSFER_UNAVAILABLE', 503, 'Transferência indisponível',
    'Chave de assinatura da Câmara ainda não foi configurada.')
  let signature
  try { ({ signature } = await signSessionTransferCandidate({ root, tenantId, ...candidate })) }
  catch (error) {
    console.error('[session-transfer] signing failed', error)
    throw new DomainError('LOCAL_TRANSFER_UNAVAILABLE', 503, 'Transferência indisponível',
      'Chave de assinatura da Câmara indisponível.')
  }
  const stillDesignated = await db.localServerDesignation.findFirst({ where: { tenantId, deviceId: device.id } })
  const stillRegistered = await db.localServerDevice.findFirst({ where: { tenantId, id: device.id, status: 'registered' } })
  if (!stillDesignated || !stillRegistered) throw unauthenticated('Servidor local não designado para esta Câmara.')
  let stream: ReadableStream<Uint8Array>
  try { stream = transferPackageStream({ ...candidate, signature }) }
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
  } })
})
