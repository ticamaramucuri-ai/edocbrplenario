/** Revoke a desktop identity and clear its designation before another download. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { requireLocalDeviceAdministrator } from '@/lib/server/local-device-identity'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const schema = z.object({ reason: z.string().trim().min(5).max(500) }).strict()

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await requireLocalDeviceAdministrator(req)
  const { id } = await ctx.params
  const { reason } = schema.parse(await req.json())
  const result = await withTransaction(async (tx) => {
    const device = await tx.localServerDevice.findFirst({ where: { id, tenantId: actor.tenantId } })
    if (!device) throw notFound('Servidor local não encontrado nesta Câmara.')
    if (device.status === 'revoked') throw new DomainError('CONFLICT_VERSION', 409, 'Já revogado', 'Esta identidade já foi revogada.')
    const updated = await tx.localServerDevice.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date() } })
    const cleared = await tx.localServerDesignation.updateMany({ where: { tenantId: actor.tenantId, deviceId: id },
      data: { deviceId: null, generation: { increment: 1 }, updatedById: actor.id } })
    await writeAudit(tx, { tenantId: actor.tenantId, actor, action: 'local_device.revoked',
      aggregateType: 'local_device', aggregateId: id, summary: 'Identidade do servidor local revogada.',
      after: { deviceId: id, fingerprint: device.publicKeySpkiSha256,
        designationCleared: cleared.count === 1 }, justification: reason,
      correlationId, ip: clientIp(req) })
    return updated
  })
  return Response.json({ device: { id: result.id, status: result.status, revokedAt: result.revokedAt } })
})
