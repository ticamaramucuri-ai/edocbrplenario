/**
 * GET|PATCH /api/v1/templates/:id — detalhe e ações sobre o modelo (Fase 14).
 *
 * GET: detalhe com bodyMd da versão atual + histórico de versões (desc por
 * version). Leitura para qualquer papel autenticado do tenant. Template de
 * outro tenant (fora do escopo resolvido) → 404 (não vaza existência).
 *
 * PATCH (RBAC template.write) discrimina por `action`:
 * - 'edit': nome/descrição (auditoria `template.updated`);
 * - 'new_version': bodyMd + changeNote → cria versão currentVersion+1 e avança
 *   o ponteiro (auditoria `template.version_added`);
 * - 'restore': copia o bodyMd da versão informada para uma versão NOVA com
 *   changeNote "Restaurado da versão N" (append-only; versão inexistente →
 *   404; auditoria `template.version_added`);
 * - 'activate' | 'deactivate': alterna `active` (desativar é SEMPRE permitido
 *   — nada é apagado; auditoria `template.deactivated` / `template.updated`).
 *
 * Histórico é append-only: versões NUNCA são editadas ou apagadas.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, clientIp, notFound } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { writeAudit } from '@/lib/server/audit'
import { restoreChangeNote, toTemplateDetail, toTemplateView } from '@/lib/server/templates'
import { TEMPLATE_KIND_LABEL, type TemplateKind } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

async function findTemplate(id: string, tenantId: string) {
  const template = await db.documentTemplate.findUnique({ where: { id } })
  if (!template || template.tenantId !== tenantId) {
    throw notFound('Modelo não encontrado neste tenant.')
  }
  return template
}

export const GET = apiHandler(async (req: Request, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params

  const template = await db.documentTemplate.findUnique({
    where: { id },
    include: { versions: true },
  })
  if (!template || template.tenantId !== tenantId) {
    throw notFound('Modelo não encontrado neste tenant.')
  }
  return Response.json({ template: toTemplateDetail(template) })
})

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    name: z
      .string()
      .trim()
      .min(3, 'Nome deve ter entre 3 e 120 caracteres.')
      .max(120, 'Nome deve ter entre 3 e 120 caracteres.')
      .optional(),
    description: z
      .string()
      .trim()
      .max(300, 'Descrição deve ter no máximo 300 caracteres.')
      .nullable()
      .optional(),
  }),
  z.object({
    action: z.literal('new_version'),
    bodyMd: z
      .string()
      .min(1, 'O corpo do modelo é obrigatório (Markdown com placeholders).')
      .max(50000, 'O corpo deve ter no máximo 50000 caracteres.'),
    changeNote: z
      .string()
      .trim()
      .max(200, 'Nota de mudança deve ter no máximo 200 caracteres.')
      .optional(),
  }),
  z.object({
    action: z.literal('restore'),
    version: z.number().int('Versão de origem deve ser inteiro positivo.').positive(
      'Versão de origem deve ser inteiro positivo.'
    ),
  }),
  z.object({ action: z.literal('activate') }),
  z.object({ action: z.literal('deactivate') }),
])

export const PATCH = apiHandler(async (req: Request, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'template.write')
  const tenantId = await resolveTenantScope(req as NextRequest, actor)
  const { id } = await ctx.params
  const body = patchSchema.parse(await req.json())
  const ip = clientIp(req)

  const current = await findTemplate(id, tenantId)
  const kindLabel = TEMPLATE_KIND_LABEL[current.kind as TemplateKind] ?? current.kind

  const updated = await withTransaction(async (tx) => {
    if (body.action === 'edit') {
      const name = body.name ?? current.name
      const description =
        body.description === undefined ? current.description : body.description || null
      const result = await tx.documentTemplate.update({
        where: { id: current.id },
        data: { name, description },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'template.updated',
        aggregateType: 'document_template',
        aggregateId: current.id,
        summary: `Modelo "${name}" (${kindLabel}) atualizado — metadados.`,
        before: { name: current.name, description: current.description },
        after: { name, description },
        correlationId,
        ip,
      })
      return result
    }

    if (body.action === 'new_version') {
      const nextVersion = current.currentVersion + 1
      await tx.documentTemplateVersion.create({
        data: {
          templateId: current.id,
          version: nextVersion,
          bodyMd: body.bodyMd,
          changeNote: body.changeNote ?? null,
          authorName: actor.name,
        },
      })
      const result = await tx.documentTemplate.update({
        where: { id: current.id },
        data: { currentVersion: nextVersion },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'template.version_added',
        aggregateType: 'document_template',
        aggregateId: current.id,
        summary: `Versão v${nextVersion} do modelo "${current.name}"${body.changeNote ? ` — ${body.changeNote}` : ''}.`,
        before: { currentVersion: current.currentVersion },
        after: { currentVersion: nextVersion, changeNote: body.changeNote ?? null },
        correlationId,
        ip,
      })
      return result
    }

    if (body.action === 'restore') {
      const source = await tx.documentTemplateVersion.findUnique({
        where: { templateId_version: { templateId: current.id, version: body.version } },
      })
      if (!source) {
        throw notFound(`Versão v${body.version} não encontrada para este modelo.`)
      }
      const nextVersion = current.currentVersion + 1
      await tx.documentTemplateVersion.create({
        data: {
          templateId: current.id,
          version: nextVersion,
          bodyMd: source.bodyMd,
          changeNote: restoreChangeNote(source.version),
          authorName: actor.name,
        },
      })
      const result = await tx.documentTemplate.update({
        where: { id: current.id },
        data: { currentVersion: nextVersion },
      })
      await writeAudit(tx, {
        tenantId,
        actor,
        action: 'template.version_added',
        aggregateType: 'document_template',
        aggregateId: current.id,
        summary: `Versão v${nextVersion} do modelo "${current.name}" — restaurado da versão v${source.version}.`,
        before: { currentVersion: current.currentVersion },
        after: { currentVersion: nextVersion, restoredFrom: source.version },
        correlationId,
        ip,
      })
      return result
    }

    // activate | deactivate — desativar é SEMPRE permitido (append-only).
    const active = body.action === 'activate'
    if (current.active === active) return current // no-op: estado já é o desejado
    const result = await tx.documentTemplate.update({
      where: { id: current.id },
      data: { active },
    })
    await writeAudit(tx, {
      tenantId,
      actor,
      action: active ? 'template.updated' : 'template.deactivated',
      aggregateType: 'document_template',
      aggregateId: current.id,
      summary: active
        ? `Modelo "${current.name}" (${kindLabel}) reativado e disponível para novas publicações.`
        : `Modelo "${current.name}" (${kindLabel}) desativado — histórico preservado (append-only).`,
      before: { active: current.active },
      after: { active },
      correlationId,
      ip,
    })
    return result
  })

  return Response.json({ template: toTemplateView(updated) })
})
