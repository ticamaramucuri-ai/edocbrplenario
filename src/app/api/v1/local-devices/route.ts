/** Register and inspect public identities of a chamber's local servers. */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { requireLocalDeviceAdministrator, parseLocalDevicePublicKey } from '@/lib/server/local-device-identity'
import { writeAudit } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().trim().min(3).max(100),
  publicKeyPem: z.string().min(40).max(1000),
  approvalReference: z.string().trim().min(3).max(200),
}).strict()

export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await requireLocalDeviceAdministrator(req)
  const [devices, designation] = await Promise.all([
    db.localServerDevice.findMany({ where: { tenantId: actor.tenantId }, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, publicKeySpkiSha256: true, status: true,
        approvalReference: true, createdAt: true, revokedAt: true } }),
    db.localServerDesignation.findUnique({ where: { tenantId: actor.tenantId } }),
  ])
  return Response.json({ devices, designation: designation && {
    deviceId: designation.deviceId, generation: designation.generation, updatedAt: designation.updatedAt } })
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await requireLocalDeviceAdministrator(req)
  const body = createSchema.parse(await req.json())
  let key: ReturnType<typeof parseLocalDevicePublicKey>
  try { key = parseLocalDevicePublicKey(body.publicKeyPem) }
  catch { throw new DomainError('VALIDATION_ERROR', 422, 'Chave inválida', 'Informe uma chave pública Ed25519 SPKI PEM do desktop.') }
  const existing = await db.localServerDevice.findUnique({ where: { publicKeySpkiSha256: key.publicKeySpkiSha256 } })
  if (existing) throw new DomainError('CONFLICT_VERSION', 409, 'Chave já cadastrada', 'Esta chave pública já consta na plataforma.')
  let device
  try { device = await withTransaction(async (tx) => {
    const created = await tx.localServerDevice.create({ data: {
      tenantId: actor.tenantId, name: body.name, publicKeyPem: key.publicKeyPem,
      publicKeySpkiSha256: key.publicKeySpkiSha256, approvalReference: body.approvalReference,
      createdById: actor.id,
    } })
    await writeAudit(tx, { tenantId: actor.tenantId, actor, action: 'local_device.registered',
      aggregateType: 'local_device', aggregateId: created.id, summary: 'Identidade pública do servidor local cadastrada.',
      after: { deviceId: created.id, fingerprint: created.publicKeySpkiSha256,
        approvalReference: body.approvalReference }, correlationId, ip: clientIp(req) })
    return created
  }) } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new DomainError('CONFLICT_VERSION', 409, 'Chave já cadastrada', 'Esta chave pública já consta na plataforma.')
    }
    throw error
  }
  return Response.json({ device: { id: device.id, name: device.name,
    publicKeySpkiSha256: device.publicKeySpkiSha256, status: device.status,
    createdAt: device.createdAt } }, { status: 201 })
})
