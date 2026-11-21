/**
 * GET /api/v1/sessions/:id/preflight — checklist operacional de pré-voo da sessão.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'
import { currentAttendance } from '@/lib/server/domain'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)
  const now = new Date()

  const [attendance, agendaCount, lease, designation, latestRevision, reconciledCount, lastReconciled] = await Promise.all([
    currentAttendance(db, session.id, session.tenantId),
    db.agendaItem.count({ where: { sessionId: session.id } }),
    db.localSessionAuthorityLease.findUnique({
      where: { sessionId: session.id },
      include: { device: { select: { id: true, name: true } } },
    }),
    db.localServerDesignation.findUnique({
      where: { tenantId: session.tenantId },
      include: { device: { select: { id: true, name: true } } },
    }),
    db.sessionAgendaRevision.findFirst({
      where: { tenantId: session.tenantId, sessionId: session.id },
      orderBy: { revision: 'desc' },
      select: { id: true, revision: true },
    }),
    db.auditEvent.count({
      where: { tenantId: session.tenantId, aggregateId: session.id, action: 'authority.reconciled_event' },
    }),
    db.auditEvent.findFirst({
      where: { tenantId: session.tenantId, aggregateId: session.id, action: 'authority.reconciled_event' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ])

  let transferConfirmed = false
  if (designation?.deviceId && latestRevision) {
    const issue = await db.localSessionTransferIssue.findFirst({
      where: {
        tenantId: session.tenantId,
        sessionId: session.id,
        deviceId: designation.deviceId,
        revisionId: latestRevision.id,
        acknowledgedAt: { not: null },
      },
      select: { id: true },
    })
    transferConfirmed = !!issue
  }

  const localAuthorityActive = !!lease && lease.expiresAt > now
  const blockers: string[] = []
  if (!session.agendaPublished) blockers.push('Pauta ainda não publicada.')
  if (agendaCount === 0) blockers.push('Nenhum item cadastrado na pauta.')
  if (!attendance.quorum.ok) {
    blockers.push(`Quórum insuficiente (${attendance.quorum.present}/${attendance.quorum.required}).`)
  }
  if (localAuthorityActive) {
    blockers.push(`Sessão sob autoridade do servidor local (${lease.device.name}, época ${lease.epoch}).`)
  }

  return Response.json({
    preflight: {
      sessionId: session.id,
      status: session.status,
      official: session.official,
      agendaPublished: session.agendaPublished,
      agendaCount,
      revision: latestRevision?.revision ?? null,
      quorum: attendance.quorum,
      designatedDesktop: designation?.device ? { id: designation.device.id, name: designation.device.name } : null,
      transferConfirmed,
      localAuthority: {
        active: localAuthorityActive,
        epoch: lease?.epoch ?? null,
        deviceName: lease?.device.name ?? null,
        expiresAt: lease?.expiresAt.toISOString() ?? null,
      },
      reconciliation: {
        reconciledEventsCount: reconciledCount,
        lastReconciledAt: lastReconciled?.createdAt.toISOString() ?? null,
      },
      readyForWebOpen: session.agendaPublished && agendaCount > 0 && attendance.quorum.ok && !localAuthorityActive,
      blockers,
    },
  })
})

