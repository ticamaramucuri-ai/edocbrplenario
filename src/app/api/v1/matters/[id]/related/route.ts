/**
 * GET|POST|DELETE /api/v1/matters/:id/related — relacionamentos entre matérias
 * (Fase 17 / ADR-018: altera|revoga|regula|subsidiaria|emenda|substitutivo).
 *
 * RBAC:
 * - GET: qualquer ator autenticado com escopo no tenant da matéria
 *   (loadMatter → assertTenantScope; platform_* tem escopo global).
 * - POST/DELETE: requirePermission 'matter.write' (tenant_admin,
 *   legislative_admin).
 *
 * Regras de negócio (POST): validação Zod na fronteira + DomainError 422 com
 * `errors` de campo para auto-referência; matéria-alvo inexistente ou de outro
 * tenant → 404/403 (padrão dos loaders).
 *
 * Fase 21 (Onda 5) — VALIDAÇÃO DE CICLOS (hardening, pendência real da Onda
 * 4): antes de criar o vínculo, percorre o grafo de `RelatedMatter` do tenant
 * (travessia bidirecional — relacionamentos são recíprocos/grafo
 * não-direcional) com limite de profundidade 50. Se a aresta `id → relatedId`
 * fechar um ciclo (existe caminho `relatedId → … → id`), rejeita com
 * `422 MATTER_CYCLE` e `extra.path` com o caminho em rótulos
 * `tipo-número/ano` (ex.: ['PL 47/2026', 'PL 49/2026', 'PL 47/2026']).
 * O vínculo duplicado direto (A→B quando B→A já existe) também é ciclo — em
 * um grafo não-direcional qualquer aresta pré-existente entre as duas matérias
 * fecha o loop. Escrita em withTransaction + writeAudit (matter.related /
 * matter.related_removed).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, DomainError, matterCycle, notFound } from '@/lib/server/errors'
import { resolveActor, assertTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { loadMatter } from '@/lib/server/loaders'
import { toRelatedMatterView, matterLabel } from '@/lib/server/serializers'
import { MATTER_RELATED_KIND_LABEL } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

// ─── F21: detecção de ciclos (DFS bidirecional, limite de profundidade 50) ──

/** Profundidade máxima da busca (nós do caminho = profundidade + 1). */
const MAX_CYCLE_DEPTH = 50

/**
 * Busca em profundidade no grafo NÃO-DIRECIONAL de relacionamentos do tenant:
 * devolve um caminho `from → … → to` (lista de ids, inclusive extremos) com no
 * máximo `maxDepth` arestas, ou null quando não existe — nesse caso a nova
 * aresta `to → from` não fecha ciclo. O conjunto `visited` é liberado no
 * backtrack para explorar todos os caminhos simples dentro do limite.
 */
function findPathDfs(
  adjacency: Map<string, string[]>,
  from: string,
  to: string,
  maxDepth: number
): string[] | null {
  const visited = new Set<string>()
  const path: string[] = []

  const dfs = (node: string): boolean => {
    path.push(node)
    if (node === to) return true
    if (path.length - 1 >= maxDepth) {
      path.pop()
      return false
    }
    visited.add(node)
    for (const neighbor of adjacency.get(node) ?? []) {
      if (neighbor === node || visited.has(neighbor)) continue
      if (dfs(neighbor)) return true
    }
    visited.delete(node)
    path.pop()
    return false
  }

  return dfs(from) ? [...path] : null
}

// ─── Rotas ──────────────────────────────────────────────────────────────────

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)

  // Ambas as direções: origem (direction 'from') e destino (direction 'to').
  const related = await db.relatedMatter.findMany({
    where: { OR: [{ matterId: matter.id }, { relatedMatterId: matter.id }] },
    include: { matter: true, relatedMatter: true },
    orderBy: { createdAt: 'asc' },
  })

  return Response.json({ related: related.map((r) => toRelatedMatterView(r, matter.id)) })
})

const createSchema = z.object({
  relatedMatterId: z.string().min(1, 'Informe a matéria-alvo do vínculo.'),
  kind: z.enum(['altera', 'revoga', 'regula', 'subsidiaria', 'emenda', 'substitutivo']),
  notes: z.string().max(2000, 'Notas devem ter no máximo 2000 caracteres.').optional(),
})

export const POST = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const body = createSchema.parse(await req.json())
  const matter = await loadMatter(actor, id)

  // Regra: auto-referência (matéria vinculada a ela mesma) — já é o menor ciclo
  // possível; mantém o problema detalhado por campo da Fase 17.
  if (body.relatedMatterId === matter.id) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Vínculo inválido',
      'Uma matéria não pode ser vinculada a ela mesma.',
      { errors: { relatedMatterId: ['A matéria-alvo não pode ser a própria matéria.'] } }
    )
  }

  // Matéria-alvo: inexistente → 404; de outro tenant → 403 (padrão loaders);
  // vínculo cruzando tenants é sempre 404 (mesmo para platform_*).
  const target = await db.legislativeMatter.findUnique({
    where: { id: body.relatedMatterId },
  })
  if (!target) throw notFound('Matéria-alvo não encontrada.')
  assertTenantScope(actor, target.tenantId)
  if (target.tenantId !== matter.tenantId) {
    throw notFound('Matéria-alvo não encontrada neste tenant.')
  }

  const created = await withTransaction(async (tx) => {
    // F21 — validação de ciclos: grafo não-direcional do tenant (toda aresta é
    // recíproca). A nova aresta matter → target fecha ciclo se JÁ existe
    // caminho target → … → matter. Isso cobre também o duplicado direto em
    // qualquer direção (A→B quando B→A existe: caminho B→A direto).
    const edges = await tx.relatedMatter.findMany({
      where: { matter: { tenantId: matter.tenantId } },
      select: { matterId: true, relatedMatterId: true },
    })
    const adjacency = new Map<string, string[]>()
    const push = (a: string, b: string) => {
      const list = adjacency.get(a)
      if (list) list.push(b)
      else adjacency.set(a, [b])
    }
    for (const e of edges) {
      if (e.matterId === e.relatedMatterId) continue
      push(e.matterId, e.relatedMatterId)
      push(e.relatedMatterId, e.matterId)
    }

    const pathIds = findPathDfs(adjacency, target.id, matter.id, MAX_CYCLE_DEPTH)
    if (pathIds) {
      const involved = await tx.legislativeMatter.findMany({
        where: { id: { in: pathIds } },
      })
      const labelById = new Map(involved.map((m) => [m.id, matterLabel(m) ?? m.id]))
      const cyclePath = [
        matterLabel(matter) ?? matter.id,
        ...pathIds.map((mid) => labelById.get(mid) ?? mid),
      ]
      throw matterCycle(
        `O vínculo fecharia um ciclo no relacionamento de matérias: ${cyclePath.join(
          ' → '
        )}. Remova um dos vínculos do caminho antes de vincular novamente.`,
        cyclePath
      )
    }

    const row = await tx.relatedMatter.create({
      data: {
        matterId: matter.id,
        relatedMatterId: target.id,
        kind: body.kind,
        notes: body.notes?.trim() || null,
      },
    })
    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.related',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `${matterLabel(matter)} vinculado a ${matterLabel(target)} (${
        MATTER_RELATED_KIND_LABEL[body.kind]
      }).`,
      after: {
        kind: body.kind,
        relatedMatterId: target.id,
        relatedMatterLabel: matterLabel(target),
        notes: body.notes?.trim() || null,
      },
      correlationId,
      ip: clientIp(req),
    })
    return row
  })

  const view = toRelatedMatterView(
    { ...created, matter, relatedMatter: target },
    matter.id
  )
  return Response.json({ related: view }, { status: 201 })
})

export const DELETE = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'matter.write')
  const { id } = await ctx.params
  const matter = await loadMatter(actor, id)

  const relatedId = new URL(req.url).searchParams.get('relatedId')?.trim()
  if (!relatedId) {
    throw new DomainError(
      'VALIDATION_ERROR',
      422,
      'Dados inválidos',
      'Informe o identificador do vínculo a remover (query ?relatedId=).',
      { errors: { relatedId: ['Parâmetro "relatedId" é obrigatório.'] } }
    )
  }

  const row = await db.relatedMatter.findUnique({ where: { id: relatedId } })
  if (!row || (row.matterId !== matter.id && row.relatedMatterId !== matter.id)) {
    throw notFound('Vínculo não encontrado para esta matéria.')
  }

  const other =
    row.matterId === matter.id
      ? await db.legislativeMatter.findUnique({ where: { id: row.relatedMatterId } })
      : await db.legislativeMatter.findUnique({ where: { id: row.matterId } })

  await withTransaction(async (tx) => {
    await tx.relatedMatter.delete({ where: { id: row.id } })
    await writeAudit(tx, {
      tenantId: matter.tenantId,
      actor,
      action: 'matter.related_removed',
      aggregateType: 'matter',
      aggregateId: matter.id,
      summary: `Vínculo removido: ${matterLabel(matter)} ↔ ${matterLabel(other)} (${
        MATTER_RELATED_KIND_LABEL[row.kind as keyof typeof MATTER_RELATED_KIND_LABEL] ?? row.kind
      }).`,
      before: {
        kind: row.kind,
        direction: row.matterId === matter.id ? 'from' : 'to',
        otherMatterId: other?.id ?? null,
        otherMatterLabel: matterLabel(other),
      },
      correlationId,
      ip: clientIp(req),
    })
  })

  return Response.json({ ok: true })
})
