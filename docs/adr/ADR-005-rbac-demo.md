# ADR-005 — Identidade e RBAC no ambiente de demonstração

## Status
Aceito (com dívida registrada)

## Contexto
O prompt exige OIDC/OAuth 2.1 + MFA para produção. O sandbox não tem provedor de identidade
e login atrapalharia a demonstração ponta a ponta.

## Decisão
1. Usuários demo (`User`) com papéis do prompt: `platform_owner`, `platform_support`,
   `tenant_admin`, `legislative_admin`, `session_operator`, `presiding_officer`,
   `parliamentarian`, `auditor`.
2. O frontend envia `x-actor-id` no seletor de perfil; **toda** rota resolve o ator,
   valida papel contra a matriz de permissões e aplica escopo de tenant server-side.
   Nenhuma rota confia em tenant/role vindos do corpo da requisição.
3. Matriz de permissões (`src/lib/server/rbac.ts`) por recurso×ação, com papéis
   `platform_*` ignorando escopo de tenant (equivalente funcional ao impersonate com
   auditoria — toda ação de platform_owner fica registrada com papel visível).
4. Parlamentar autenticado só lança o PRÓPRIO voto; operador/mesa pode lançar por
   qualquer parlamentar presente (fluxo de plenário com mesas físicas).

## Consequências
- Autorização real e verificável no backend; substituição por OIDC/NextAuth é troca da
  camada de resolução de ator sem alterar a matriz.
- Dívida: MFA, sessões expiráveis e cofre de credenciais ficam para produção.
