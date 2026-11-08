/** Choose the sole desktop eligible to authenticate downloads for this chamber. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, notFound } from '@/lib/server/errors'
import { requireLocalDeviceAdministrator } from '@/lib/server/local-device-identity'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const schema = z.object({ expectedGeneration: z.number().int().nonnegative(),
  approvalReference: z.string().trim().min(3).max(200) }).strict()

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await requireLocalDeviceAdministrator(req)
  const { id } = await ctx.params
  const body = schema.parse(await req.json())
  const designation = await withTransaction(async (tx) => {
    const device = await tx.localServerDevice.findFirst({ where: { id, tenantId: actor.tenantId, status: 'registered' } })
    if (!device) throw notFound('Servidor local ativo não encontrado nesta Câmara.')
    const current = await tx.localServerDesignation.findUnique({ where: { tenantId: actor.tenantId } })
    if ((current?.generation ?? 0) !== body.expectedGeneration) {
      throw new DomainError('CONFLICT_VERSION', 409, 'Designação alterada', 'Recarregue a geração do servidor designado.')
    }
    if (current) {
      const changed = await tx.localServerDesignation.updateMany({ where: {
        tenantId: actor.tenantId, generation: body.expectedGeneration }, data: {
        deviceId: id, generation: { increment: 1 }, updatedById: actor.id } })
      if (changed.count !== 1) throw new DomainError('CONFLICT_VERSION', 409, 'Designação alterada', 'Recarregue a geração do servidor designado.')
    } else {
      try { await tx.localServerDesignation.create({ data: { tenantId: actor.tenantId, deviceId: id,
        generation: 1, updatedById: actor.id } }) }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
          throw new DomainError('CONFLICT_VERSION', 409, 'Designação alterada', 'Recarregue a geração do servidor designado.')
        }
        throw error
      }
    }
    const updated = await tx.localServerDesignation.findUniqueOrThrow({ where: { tenantId: actor.tenantId } })
    await writeAudit(tx, { tenantId: actor.tenantId, actor, action: 'local_device.designated',
      aggregateType: 'local_device', aggregateId: id, summary: 'Servidor local principal designado.',
      before: { deviceId: current?.deviceId ?? null, generation: current?.generation ?? 0 },
      after: { deviceId: id, generation: updated.generation, approvalReference: body.approvalReference },
      correlationId, ip: clientIp(req) })
    return updated
  })
  return Response.json({ designation: { deviceId: designation.deviceId, generation: designation.generation } })
})
