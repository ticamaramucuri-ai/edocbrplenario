# Etapa 082 — Testes locais de webhook e imagens

**Fase:** L1, cobertura de serviços e estrutura legislativa  
**Data:** 10/11/2026  
**Base:** checkout local baseado no registro `1422b5f`; árvore de trabalho contém incrementos anteriores ainda não consolidados  
**Ambiente:** Linux, Bun 1.4.2, SQLite isolado em `/tmp`, sem envio de requisições externas

## Objetivo

Exercitar o remetente HTTP de webhook com `fetch` simulado e as regras de URL/volume das imagens de parlamentares, sem conectar ao PostgreSQL nem usar o banco de desenvolvimento.

## Comandos e resultados

```sh
DATABASE_URL=file:/tmp/codex-webhook-http-20261110.db bun test tests/webhook-http-delivery.test.ts
DATABASE_URL=file:/tmp/codex-parliamentarian-images-20261110.db bun test tests/parliamentarian-images.test.ts
```

| Grupo | Resultado observado |
|---|---:|
| Webhook HTTP | 1 teste aprovado, 15 assertions |
| Imagens de parlamentares | 3 testes aprovados, 8 assertions |
| **Total** | **4 testes aprovados, 23 assertions, 0 falhas** |

O teste de webhook confirmou corpo preservado, POST, assinatura HMAC SHA-256, identificador/evento estáveis entre tentativa com resposta 503 e nova tentativa com resposta 204. As chamadas foram atendidas por um `fetch` falso; nenhum destino externo foi contatado.

Os testes de imagem confirmaram isolamento da URL por tenant, rejeição de traversal e host externo, aceitação de imagem opcional vazia e exigência de caminho absoluto para o volume.

## Limites e próximo passo

Esta etapa não cobre persistência da fila, entrega PostgreSQL concorrente, scheduler PostgreSQL/HTTP, rota de upload autenticada nem inspeção de imagem. O conjunto `scripts/test-postgres-foundation.sh` prepara um PostgreSQL Docker temporário e executa várias provas integradas; auditar os pré-requisitos e rodá-lo como grupo isolado na próxima etapa. Também permanecem pendentes a auditoria das rotas de migração e jornadas de UI.
