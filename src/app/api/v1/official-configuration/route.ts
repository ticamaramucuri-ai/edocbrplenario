import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { apiHandler, clientIp, DomainError } from '@/lib/server/errors'
import { withTransaction } from '@/lib/server/tx'
import { writeAudit } from '@/lib/server/audit'
import { inspectOfficialConfiguration } from '@/lib/server/official-configuration'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  approvalReference: z.string().trim().min(3).max(200),
  acknowledged: z.literal(true),
}).strict()

export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)
  const inspection = await inspectOfficialConfiguration(db, tenantId)
  const revisions = await db.officialConfigurationRevision.findMany({
    where: { tenantId }, orderBy: { version: 'desc' }, take: 10,
    select: { id: true, version: true, snapshotSha256: true, approvalReference: true, approvedByName: true, approvedAt: true },
  })
  return Response.json({
    ...inspection,
    snapshotJson: undefined,
    approved: inspection.ready && revisions[0]?.snapshotSha256 === inspection.snapshotSha256,
    revisions,
  })
})

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'tenant.update')
  const tenantId = await resolveTenantScope(req, actor)
  const body = bodySchema.parse(await req.json())
  const revision = await withTransaction(async (tx) => {
    const inspection = await inspectOfficialConfiguration(tx, tenantId)
    if (!inspection.ready) throw new DomainError('SESSION_PRECONDITION', 409, 'Configuração incompleta', 'Resolva os itens pendentes antes de aprovar a configuração oficial.')
    if (inspection.snapshotSha256 !== body.expectedSha256) throw new DomainError('CONFLICT_VERSION', 409, 'Configuração alterada', 'Recarregue a prontidão antes de aprovar.')
    const latest = await tx.officialConfigurationRevision.findFirst({ where: { tenantId }, orderBy: { version: 'desc' } })
    if (latest?.snapshotSha256 === inspection.snapshotSha256) throw new DomainError('CONFLICT_VERSION', 409, 'Já aprovada', 'Esta versão já está aprovada.')
    const created = await tx.officialConfigurationRevision.create({ data: {
      tenantId, version: (latest?.version ?? 0) + 1,
      snapshotJson: inspection.snapshotJson, snapshotSha256: inspection.snapshotSha256,
      approvalReference: body.approvalReference,
      approvedById: actor.id, approvedByName: actor.name,
    } })
    await writeAudit(tx, {
      tenantId, actor, action: 'official_configuration.approved', aggregateType: 'official_configuration',
      aggregateId: created.id, summary: `Configuração institucional v${created.version} aprovada internamente.`,
      after: { version: created.version, snapshotSha256: created.snapshotSha256, approvalReference: created.approvalReference },
      correlationId, ip: clientIp(req),
    })
    return created
  })
  return Response.json({ revision: { id: revision.id, version: revision.version, snapshotSha256: revision.snapshotSha256 } }, { status: 201 })
})
