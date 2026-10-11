# ADR-010 — Autenticação real (e-mail/senha) coexistindo com o modo demo

**Status:** Aceito · **Data:** Fase 9 · **Contexto:** sandbox (Next.js 16 + Prisma/SQLite)

## Contexto

O RBAC original (ADR-005) resolve o ator exclusivamente pelo header `x-actor-id` — atalho de
demonstração. O prompt mestre exige OIDC/MFA em produção; no sandbox não há provedor de
identidade externo. A Fase 8 documentou ainda um gap: tenant desativado não bloqueava
papéis com escopo de tenant.

Além disso, o ciclo de vida de usuários (criar, redefinir senha, desativar) não existia —
atores eram criados apenas pelo seed.

## Decisão

1. **Login por e-mail/senha com hash `scrypt`** (`scrypt$<salt>$<hash>`, salt 16 bytes,
   hash 64 bytes, `timingSafeEqual`). Sem dependência externa (node:crypto). Mensagem de
   falha sempre genérica (`INVALID_CREDENTIALS` 401) — sem enumeração de e-mails.
2. **Sessão persistida em `AuthSession`** entregue como cookie httpOnly `legis_session`
   (SameSite=Lax, 7 dias). O banco guarda apenas o **SHA-256 do token** (`tokenHash`) —
   o token puro nunca é persistido. Logout revoga (`revokedAt`); troca de senha e
   desativação de usuário revogam TODAS as suas sessões.
3. **Resolução do ator em cascata:** cookie de sessão → `x-actor-id` (demo preservado) →
   401. A sessão tem prioridade: um ator demo selecionado não sobrepõe um login real.
4. **Enforcement de tenant ativo:** papel com escopo de tenant + `tenant.active=false` →
   `403 TENANT_INACTIVE` (novo código estável) tanto no login quanto na resolução de
   cada requisição. Papéis `platform_*` mantêm escopo global.
5. **Gestão de usuários** (`user.manage`: tenant_admin, platform_owner): criar (com senha
   inicial), editar, redefinir senha, ativar/desativar. **Exclusão não existe** — histórico
   de auditoria é imutável. Papel `parliamentarian` exige vínculo com parlamentar do
   próprio tenant (validação server-side).
6. **Gate de entrada único:** formulário de login ACIMA dos perfis de demonstração; o
   primeiro acesso sem credencial sempre abre o gate (fim do auto-login). "Sair" no topbar
   revoga a sessão, limpa o estado local (localStorage + zustand persist) e volta ao gate.
7. Auditoria: `auth.login` apenas em sucesso e quando o usuário tem tenant (falhas de
   senha não são auditadas — evita ruído e enumeração).

## Senhas de demonstração (seed)

`DemoLegis!2026` para `ana.ribeiro@vilanova.mg.leg.br` (admin), `carla.mendes@…`
(parlamentar), `marta.lima@serraazul.sp.leg.br` (admin tenant 2) e `suporte@legissaas.dev`
(platform_owner). O usuário `tiago.almeida@…` está **inativo** para demonstrar bloqueio.

## Consequências

- (+) Matriz RBAC idêntica; credencial real verificável; sessões revogáveis; gap de tenant
  desativado fechado; usuários gerenciáveis pelo próprio tenant.
- (−) Sessões ficam no SQLite do sandbox (sem store distribuído) e o cookie não é `Secure`
  (gateway HTTP). MFA/OIDC/recuperação de senha por e-mail permanecem requisitos de
  produção — ver `docs/runbook.md` §Limitações.
- (→) Migração para produção: trocar o resolvedor por provedor OIDC mantendo o contrato
  `ResolvedActor` — as rotas não mudam.
