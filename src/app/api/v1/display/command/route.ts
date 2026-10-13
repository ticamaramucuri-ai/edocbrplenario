/**
 * POST /api/v1/display/command — comandos do telão (RBAC display.command):
 * freeze|unfreeze|clear|publish|profile. Emite `display.command` no outbox
 * com publicPayload = internalPayload (telões são públicos).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { emitOutbox } from '@/lib/server/outbox'
import { displayStateChange } from '@/lib/display-state'
import { parseDisplayState } from '@/lib/display-state'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    sessionId: z.string().min(1, 'Informe a sessão.'),
    action: z.enum(['freeze', 'unfreeze', 'clear', 'publish', 'profile']),
    profile: z
      .enum(['boas_vindas', 'presenca', 'pauta', 'votacao', 'discurso', 'encerramento'])
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action === 'profile' && !body.profile) {
      ctx.addIssue({
        code: 'custom',
        path: ['profile'],
        message: 'Informe o perfil do telão (boas_vindas|presenca|pauta|votacao|discurso|encerramento).',
      })
    }
  })

export const POST = apiHandler(async (req: NextRequest, _ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'display.command')
  const body = bodySchema.parse(await req.json())

  const session = await loadSession(actor, body.sessionId)

  const state = await withTransaction(async (tx) => {
    const change = displayStateChange(body.action, body.profile)
    const state = await tx.displayState.upsert({
      where: { sessionId: session.id },
      create: { sessionId: session.id, tenantId: session.tenantId, ...change },
      update: { ...change, version: { increment: 1 } },
    })
    const payload = {
      sessionId: session.id,
      action: body.action,
      profile: body.profile ?? null,
      displayVersion: state.version,
    }
    await emitOutbox(tx, {
      tenantId: session.tenantId,
      eventType: 'display.command',
      aggregateId: session.id,
      sessionId: session.id,
      aggregateVersion: state.version,
      correlationId,
      internalPayload: payload,
      publicPayload: payload,
    })
    return state
  })

  return Response.json({ ok: true, displayVersion: state.version })
})

export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'display.command')
  const sessionId = z.string().min(1).parse(req.nextUrl.searchParams.get('sessionId'))
  const session = await loadSession(actor, sessionId)
  const row = await db.displayState.findUnique({ where: { sessionId: session.id } })
  return Response.json({ state: parseDisplayState(row) })
})
