# Etapa 089 — Sessões de autenticação e API keys

**Fase:** L1/L5, gestão de acesso e credenciais externas  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2, SQLite descartável; ator de fixture em modo demonstração; sem tráfego de API externo

## Incremento

Adicionei `tests/auth-session-api-key.test.ts`, `scripts/test-auth-session-api-key.sh` e o comando `bun run test:auth:access-management`.

## Resultado observado

```sh
bun run test:auth:access-management
```

**1 teste aprovado, 28 assertions, zero falhas.** O caso verifica RBAC na emissão, validação de escopos, formato da chave, hash persistido e não reversível, ausência do segredo/hash na listagem e view, emissão única do segredo, autenticação Bearer numa rota externa real, escopo insuficiente (403), token inválido ou revogado (401), paginação e isolamento de dados da Câmara. Também confirma recusa de revogação por outro tenant, revogação idempotente com auditoria única, listagem apenas de sessões ativas e não expiradas do usuário, ausência de sessão “current” sem cookie e revogação própria idempotente. Sessão de outra pessoa recebe resposta indistinguível de inexistente (404).

## Limites

O ensaio usa o modo de ator de demonstração para gestão, e SQLite descartável na rota de consulta. Não autentica com senha/cookie. Não cobre login, MFA interativo, configuração TOTP, gestão de usuários (criar/editar/trocar senha/desativar) nem autorização de todas as rotas para cada papel. Nenhum serviço externo foi chamado.
