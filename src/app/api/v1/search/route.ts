/**
 * GET /api/v1/search?q= (Fase 13) — pesquisa unificada (⌘K).
 * Busca case-insensitive (contains) com TOP 5 por seção, no escopo do tenant
 * do ator. As 4 seções vêm SEMPRE presentes (vazias quando sem match):
 * - matters: ementa/autores (JSON string)/número;
 * - sessions: número/ano/tipo;
 * - parliamentarians: nome/partido/bloco;
 * - publications: título/kind.
 * RBAC: leitura liberada para qualquer papel autenticado. `q` mínimo de
 * 2 caracteres (ausente/curto → 422 Problem Details).
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiHandler } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import {
  MATTER_TYPE_SHORT,
  MATTER_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  SESSION_STATUS_LABEL,
  type SearchItemView,
  type SearchResponse,
  type SearchSectionId,
} from '@/lib/contracts'
import {
  PUBLICATION_STATUS_LABEL,
  publicationNumberLabel,
} from '@/lib/server/publications'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().trim().min(2, 'Informe ao menos 2 caracteres para pesquisar.'),
})

const truncate = (s: string, max = 110) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s

/** "30/08/2026 19:00" — wall-clock persistido (UTC), exibido sem conversão. */
const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)

export const GET = apiHandler(async (req: NextRequest, _ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req, actor)

  const { q } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()))

  // Número/ano: habilita busca por "43" ou "2026" quando o termo é numérico.
  const asInt = /^\d+$/.test(q) ? Number(q) : null

  const [matters, sessions, parliamentarians, publications] = await Promise.all([
    db.legislativeMatter.findMany({
      where: {
        tenantId,
        OR: [
          { ementa: { contains: q } },
          { authors: { contains: q } },
          ...(asInt !== null ? [{ number: asInt }, ...(asInt >= 2000 && asInt <= 2100 ? [{ year: asInt }] : [])] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    db.session.findMany({
      where: {
        tenantId,
        OR: [
          { type: { contains: q } },
          ...(asInt !== null ? [{ number: asInt }, { year: asInt }] : []),
        ],
      },
      orderBy: { scheduledAt: 'desc' },
      take: 5,
    }),
    db.parliamentarian.findMany({
      where: {
        tenantId,
        OR: [{ name: { contains: q } }, { party: { contains: q } }, { bloc: { contains: q } }],
      },
      orderBy: { order: 'asc' },
      take: 5,
    }),
    db.publication.findMany({
      where: {
        tenantId,
        OR: [{ title: { contains: q } }, { kind: { contains: q } }],
      },
      orderBy: [{ year: 'desc' }, { number: 'desc' }],
      take: 5,
    }),
  ])

  const matterItems: SearchItemView[] = matters.map((m) => ({
    id: m.id,
    title: `${MATTER_TYPE_SHORT[m.type as keyof typeof MATTER_TYPE_SHORT] ?? m.type} ${m.number}/${m.year}`,
    hint: `${MATTER_STATUS_LABEL[m.status as keyof typeof MATTER_STATUS_LABEL] ?? m.status} · ${truncate(m.ementa)}`,
    module: 'matters',
  }))

  const sessionItems: SearchItemView[] = sessions.map((s) => ({
    id: s.id,
    title: `${SESSION_TYPE_LABEL[s.type as keyof typeof SESSION_TYPE_LABEL] ?? s.type} nº ${s.number}/${s.year}`,
    hint: `${fmtDateTime(s.scheduledAt)} · ${SESSION_STATUS_LABEL[s.status as keyof typeof SESSION_STATUS_LABEL] ?? s.status}`,
    module: 'sessions',
  }))

  const parliamentarianItems: SearchItemView[] = parliamentarians.map((p) => ({
    id: p.id,
    title: p.displayName || p.name,
    hint: [p.party, p.bloc].filter(Boolean).join(' · ') || null,
    module: 'parliamentarians',
  }))

  const publicationItems: SearchItemView[] = publications.map((p) => ({
    id: p.id,
    title: p.title,
    hint: `${publicationNumberLabel(p.number, p.year)} · ${PUBLICATION_STATUS_LABEL[p.status] ?? p.status}`,
    module: 'publications',
  }))

  const sections: SearchResponse['sections'] = [
    { id: 'matters' as SearchSectionId, items: matterItems },
    { id: 'sessions' as SearchSectionId, items: sessionItems },
    { id: 'parliamentarians' as SearchSectionId, items: parliamentarianItems },
    { id: 'publications' as SearchSectionId, items: publicationItems },
  ]

  const body: SearchResponse = { query: q, sections }
  return Response.json(body)
})
