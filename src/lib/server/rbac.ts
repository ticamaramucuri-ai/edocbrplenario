/**
 * Matriz de permissões — EXATAMENTE a do contrato (docs/api-contract.md).
 * ADR-005: autorização real server-side; matriz espelhada em src/lib/store.ts.
 */
import type { Role } from '@/lib/contracts'
import type { ResolvedActor } from './actor'
import { forbiddenRole } from './errors'

export const PERMISSIONS: Record<string, Role[]> = {
  'tenant.update': ['tenant_admin', 'platform_owner'],
  'parliamentarian.write': ['tenant_admin', 'legislative_admin'],
  'matter.write': ['tenant_admin', 'legislative_admin'],
  'session.create': ['tenant_admin', 'legislative_admin'],
  'session.transition': ['session_operator', 'presiding_officer', 'tenant_admin'],
  'attendance.write': ['session_operator', 'tenant_admin'],
  'voting.write': ['session_operator', 'presiding_officer', 'tenant_admin'],
  'voting.impediment.reason.read': ['session_operator', 'presiding_officer', 'tenant_admin', 'legislative_admin', 'auditor', 'platform_owner'],
  'vote.cast': ['session_operator', 'presiding_officer', 'parliamentarian'],
  'speech.write': ['session_operator', 'tenant_admin'],
  'display.command': ['session_operator', 'tenant_admin'],
  'media.read': ['media_operator', 'session_operator', 'tenant_admin'],
  'media.manage': ['media_operator', 'session_operator', 'tenant_admin'],
  'audit.read': ['auditor', 'tenant_admin', 'platform_owner'],
  'structure.write': ['tenant_admin', 'legislative_admin'],
  'protocol.write': ['tenant_admin', 'legislative_admin'],
  'task.write': ['tenant_admin', 'legislative_admin', 'session_operator'],
  'webhook.manage': ['tenant_admin'],
  'notification.broadcast': ['tenant_admin'],
  // Fase 7 — IA assistiva (uso e revisão humana obrigatória)
  'ai.use': ['tenant_admin', 'legislative_admin', 'session_operator', 'presiding_officer'],
  'ai.review': ['tenant_admin', 'legislative_admin'],
  // Fase 7 — App do Parlamentar (self service /me)
  'self.attendance': ['parliamentarian'],
  'self.vote': ['parliamentarian'],
  'self.speech': ['parliamentarian'],
  // Fase 8 — Console da plataforma (operação SaaS, escopo global)
  'platform.manage': ['platform_owner'],
  // Fase 8 — Importador de migração (pipeline auditável)
  'migration.manage': ['tenant_admin', 'legislative_admin', 'platform_owner'],
  // Fase 9 — Gestão de usuários do tenant (autenticação real)
  'user.manage': ['tenant_admin', 'platform_owner'],
  // Fase 10 — Faturamento usa platform.manage (escopo global)
  // Fase 11 — Publicações oficiais e audiências públicas
  'publication.write': ['tenant_admin', 'legislative_admin'],
  'hearing.write': ['tenant_admin', 'legislative_admin'],
  // Fase 12 — Analytics/BI (leitura agregada do próprio tenant)
  'analytics.read': [
    'tenant_admin',
    'legislative_admin',
    'session_operator',
    'presiding_officer',
    'parliamentarian',
    'auditor',
    'platform_owner',
  ],
  // Fase 14 — Modelos de documento versionados
  'template.write': ['tenant_admin', 'legislative_admin'],
  // Onda 4 / Fase 19 — Assinaturas do cidadão (gestão pelo tenant)
  'subscription.manage': ['tenant_admin', 'legislative_admin'],
  // Onda 4 / Fase 20 — Suporte da plataforma (leitura operacional + impersonação)
  'platform.read': ['platform_owner', 'platform_support'],
  'impersonation.manage': ['platform_owner', 'platform_support'],
  // Onda 5 / Fase 23 — Chaves de API do tenant (emissão e revogação)
  'apikey.manage': ['tenant_admin'],
}

/** 403 FORBIDDEN_ROLE quando o papel do ator não está na matriz da ação. */
export function requirePermission(actor: ResolvedActor, action: keyof typeof PERMISSIONS | string): void {
  const allowed = PERMISSIONS[action]
  if (!allowed) {
    // Ação desconhecida = fechado por padrão.
    throw forbiddenRole(`Ação "${action}" não existe na matriz de permissões.`)
  }
  if (!allowed.includes(actor.role)) {
    throw forbiddenRole(
      `Papel "${actor.role}" não pode executar "${action}". Papéis permitidos: ${allowed.join(', ')}.`
    )
  }
}
