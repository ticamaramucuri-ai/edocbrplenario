/** Desktop attests that the complete signed revision was imported and reread. */
import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler, DomainError, notFound, unauthenticated } from '@/lib/server/errors'
import { authenticateLocalDeviceRequest } from '@/lib/server/local-device-identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const receiptSchema = z.object({
  issueId: z.string().min(1).max(200),
  revisionId: z.string().min(1).max(200),
  revisionNumber: z.number().int().positive(),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  artifacts: z.array(z.object({ id: z.string().min(1).max(200),
    sha256: z.string().regex(/^[0-9a-f]{64}$/), sizeBytes: z.number().int().nonnegative() }).strict()).max(500),
}).strict()

async function boundedBody(req: Request): Promise<Buffer> {
  if (!req.body) throw new DomainError('VALIDATION_ERROR', 422, 'Confirmação inválida', 'Corpo JSON obrigatório.')
  const reader = req.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > 256 * 1024) throw new DomainError('VALIDATION_ERROR', 413, 'Confirmação grande demais',
        'Confirmação de transferência excede 256 KiB.')
      chunks.push(Buffer.from(next.value))
    }
  } finally { await reader.cancel().catch(() => undefined) }
  return Buffer.concat(chunks, total)
}

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const tenantId = req.headers.get('x-edocbr-tenant-id') ?? ''
  if (!tenantId || tenantId.length > 200) throw unauthenticated('Identidade da Câmara ausente ou inválida.')
  const raw = await boundedBody(req)
  const bodySha256 = createHash('sha256').update(raw).digest('hex')
  const device = await authenticateLocalDeviceRequest(req, tenantId, bodySha256)
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new DomainError('VALIDATION_ERROR', 422, 'Confirmação inválida', 'Use JSON.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw.toString('utf8')) }
  catch { throw new DomainError('VALIDATION_ERROR', 422, 'Confirmação inválida', 'JSON inválido.') }
  const body = receiptSchema.parse(parsed)
  const { id } = await ctx.params
  const issue = await db.localSessionTransferIssue.findFirst({ where: {
    id: body.issueId, tenantId, deviceId: device.id, sessionId: id },
  })
  if (!issue) throw notFound('Emissão de pacote não encontrada para este desktop.')
  if (issue.revisionId !== body.revisionId || issue.revisionNumber !== body.revisionNumber ||
      issue.manifestSha256 !== body.manifestSha256 ||
      issue.artifactHashesJson !== JSON.stringify(body.artifacts)) {
    throw new DomainError('LOCAL_TRANSFER_ACK_MISMATCH', 409, 'Confirmação divergente',
      'A confirmação não corresponde aos bytes emitidos para este desktop.')
  }
  if (!issue.acknowledgedAt) {
    await db.localSessionTransferIssue.updateMany({ where: { id: issue.id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date() } })
  }
  const acknowledged = await db.localSessionTransferIssue.findUniqueOrThrow({ where: { id: issue.id } })
  return Response.json({ issueId: issue.id, revisionId: issue.revisionId,
    acknowledgedAt: acknowledged.acknowledgedAt, accepted: true },
  { headers: { 'Cache-Control': 'private, no-store' } })
})
