/**
 * Domínio de Modelos de Documento versionados por tenant (Fase 14, §7.10).
 *
 * Regras centrais:
 * - Corpo é Markdown PURO com placeholders `{{token}}`; o render NÃO interpola
 *   HTML (o front renderiza com react-markdown sanitizado).
 * - Tokens conhecidos são substituídos pelo contexto (tenant/sessão/matéria);
 *   tokens desconhecidos PERMANECEM no texto e são devolvidos em `unresolved`
 *   para revisão humana (nunca falham o render).
 * - Histórico append-only: versões nunca são editadas nem apagadas;
 *   `restore` SEMPRE cria uma versão nova copiando o corpo da versão de origem.
 * - Auditoria: template.created / template.updated / template.version_added /
 *   template.deactivated / template.rendered (sem outbox — ADR-015).
 */
import type {
  DocumentTemplate,
  DocumentTemplateVersion,
  LegislativeMatter,
  Session,
  Tenant,
} from '@prisma/client'
import type { TemplateDetail, TemplateKind, TemplateVersionView, TemplateView } from '@/lib/contracts'
import { MATTER_TYPE_LABEL, SESSION_TYPE_LABEL } from '@/lib/contracts'
import { parseAuthors } from './serializers'

export const TEMPLATE_KINDS = [
  'ata_sessao',
  'decreto',
  'resolucao',
  'portaria',
  'edital',
  'oficio',
] as const
export type TemplateKindId = (typeof TEMPLATE_KINDS)[number]

/** Nota de mudança gerada pelo restore: "Restaurado da versão N". */
export function restoreChangeNote(version: number): string {
  return `Restaurado da versão ${version}`
}

// ─── Render de placeholders ─────────────────────────────────────────────────

const TOKEN_RE = /\{\{([^}]+)\}\}/g

/**
 * Substitui `{{token}}` conhecido pelo valor do contexto. Tokens desconhecidos
 * permanecem no texto (revisão humana) e são listados (sem duplicatas) em
 * `unresolved`, com o nome do token aparado (sem as chaves).
 */
export function renderTemplate(
  bodyMd: string,
  ctx: Record<string, string>
): { rendered: string; unresolved: string[] } {
  const unresolved = new Set<string>()
  const rendered = bodyMd.replace(TOKEN_RE, (match, rawToken: string) => {
    const token = String(rawToken).trim()
    if (Object.prototype.hasOwnProperty.call(ctx, token)) return ctx[token]
    unresolved.add(token)
    return match
  })
  return { rendered, unresolved: [...unresolved] }
}

// ─── Contexto de render ─────────────────────────────────────────────────────

const MESES_PT_BR = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** Data por extenso em pt-BR: "12 de fevereiro de 2026". */
export function formatPtBrLongDate(d: Date): string {
  return `${d.getDate()} de ${MESES_PT_BR[d.getMonth()]} de ${d.getFullYear()}`
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type TenantLike = Pick<Tenant, 'name' | 'city' | 'uf'>
type SessionLike = Pick<Session, 'number' | 'year' | 'type' | 'scheduledAt'>
type MatterLike = Pick<LegislativeMatter, 'type' | 'number' | 'year' | 'ementa' | 'authors'>

/**
 * Contexto de render: dados do tenant sempre; sessão e matéria apenas quando
 * informados (tokens correspondentes ficam ausentes do contexto e, se usados
 * no corpo, retornam em `unresolved`).
 */
export function buildTemplateContext(
  tenant: TenantLike,
  session?: SessionLike | null,
  matter?: MatterLike | null
): Record<string, string> {
  const now = new Date()
  const ctx: Record<string, string> = {
    camara: tenant.name,
    cidade: tenant.city,
    uf: tenant.uf,
    data: formatPtBrLongDate(now),
    hora: hhmm(now),
    ano: String(now.getFullYear()),
  }
  if (session) {
    ctx['sessao.numero'] = `nº ${session.number}/${session.year}`
    ctx['sessao.data'] = formatPtBrLongDate(session.scheduledAt)
    ctx['sessao.tipo'] = SESSION_TYPE_LABEL[session.type as keyof typeof SESSION_TYPE_LABEL] ?? session.type
  }
  if (matter) {
    ctx['materia.titulo'] = `${
      MATTER_TYPE_LABEL[matter.type as keyof typeof MATTER_TYPE_LABEL] ?? matter.type
    } nº ${matter.number}/${matter.year}`
    ctx['materia.ementa'] = matter.ementa
    ctx['materia.autores'] = parseAuthors(matter.authors).join(', ')
  }
  return ctx
}

// ─── Views (contratos de contracts.ts) ──────────────────────────────────────

export function toTemplateVersionView(v: DocumentTemplateVersion): TemplateVersionView {
  return {
    id: v.id,
    version: v.version,
    changeNote: v.changeNote ?? null,
    authorName: v.authorName,
    createdAt: v.createdAt.toISOString(),
  }
}

export function toTemplateView(t: DocumentTemplate): TemplateView {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind as TemplateKind,
    description: t.description ?? null,
    active: t.active,
    currentVersion: t.currentVersion,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

/** Detalhe com o corpo da versão atual e o histórico (desc por version). */
export function toTemplateDetail(
  t: DocumentTemplate & { versions: DocumentTemplateVersion[] }
): TemplateDetail {
  const versions = [...t.versions].sort((a, b) => b.version - a.version)
  const current = versions.find((v) => v.version === t.currentVersion) ?? null
  return {
    ...toTemplateView(t),
    bodyMd: current?.bodyMd ?? '',
    versions: versions.map(toTemplateVersionView),
  }
}
