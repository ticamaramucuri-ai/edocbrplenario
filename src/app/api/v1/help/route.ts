/**
 * GET /api/v1/help — conteúdo estruturado da Central de Ajuda (Fase 15).
 *
 * Qualquer papel autenticado (INCLUSIVE platform_owner, que não tem tenant —
 * por isso NÃO há resolveTenantScope aqui). O conteúdo é versionado com o
 * código em src/lib/server/help-content.ts (ADR-016).
 */
import type { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { buildHelpContent } from '@/lib/server/help-content'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  await resolveActor(req)
  return Response.json(buildHelpContent())
})
