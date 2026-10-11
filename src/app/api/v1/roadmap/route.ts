/**
 * GET /api/v1/roadmap — conteúdo do módulo "Planejamento e Roadmap" (v0.12.0).
 *
 * Qualquer papel autenticado (INCLUSIVE platform_owner, que não tem tenant —
 * por isso NÃO há resolveTenantScope aqui), mesmo padrão do GET /help.
 * As fases/tasks da Onda 5 vêm do banco (progresso rastreável); o restante é
 * versionado com o código em src/lib/server/roadmap-content.ts (ROADMAP §12).
 */
import type { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { buildRoadmapContent } from '@/lib/server/roadmap-content'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  await resolveActor(req)
  return Response.json(await buildRoadmapContent())
})
