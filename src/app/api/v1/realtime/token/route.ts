import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { issueRealtimeGrant, realtimeSecret } from '@/lib/realtime-auth'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request) => {
  const actor = await resolveActor(req)
  const secret = realtimeSecret()
  if (!secret) {
    return Response.json(
      { error: 'REALTIME_NOT_CONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const tenantId = await resolveTenantScope(req, actor)
  return Response.json(
    { token: issueRealtimeGrant(tenantId, actor.id, secret) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
