import type { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { recordingSnapshot } from '@/lib/server/media-control'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'media.read')
  const { id } = await ctx.params
  await loadSession(actor, id)
  return Response.json(await recordingSnapshot(`session-${id}`), { headers: { 'Cache-Control': 'no-store' } })
})
