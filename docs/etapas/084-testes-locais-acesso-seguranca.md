# Etapa 084 — Acesso e segurança local

**Fase:** L1/L5, autenticação, limites de acesso e proteção operacional  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2; SQLite temporário nomeado em `/tmp`; sem rede externa  
**Comando:**

```sh
DATABASE_URL=file:/tmp/codex-access-security-20261110.db bun test \
  tests/realtime-auth.test.ts tests/demo-mode.test.ts \
  tests/platform-monitor-boundary.test.ts tests/database-guard.test.ts \
  tests/database-unavailable.test.ts tests/realtime-endpoint.test.ts
```

## Resultado observado

**27 testes aprovados, 53 assertions, zero falhas.** Foram cobertos tokens internos de realtime (validade, assinatura, alteração e formato inválido), ativação explícita do modo demonstração, limite de acesso do monitor, recusa de banco de desenvolvimento e symlink para esse banco, precedência de `DATABASE_URL`, endereço do gateway realtime e respostas seguras para indisponibilidade/erro interno.

Uma linha de log de erro inesperado (`bug`) foi emitida pelo teste que comprova a resposta HTTP 500 sem exposição do detalhe interno; o caso passou.

## Limites

Este bloco não cobre MFA interativo, gerenciamento de sessões e API keys, nem uma matriz exaustiva de autorização de todas as rotas para todos os papéis. O teste de identidade local que exige MFA nominal passou na etapa 083, mas não substitui esses fluxos. Próxima ação: mapear handlers de autenticação/usuários e implementar ou executar cenários locais específicos para as lacunas, sem presumir cobertura pelo nome do papel.
