/**
 * GET /api/v1/platform/alerts — alertas operacionais PERSISTENTES (Fase 20).
 * RBAC `platform.read` (platform_owner e platform_support — o suporte precisa
 * enxergar a operação; o reconhecimento continua exclusivo do owner em
 * /platform/alerts/:id/ack). Lista abertos primeiro (mais recentes primeiro),
 * depois reconhecidos (ack mais recente), máx 50.
 */
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { listPlatformAlertViews } from '@/lib/server/platform-alerts'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: Request, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'platform.read')

  const alerts = await listPlatformAlertViews(50)
  return Response.json({ alerts })
})
