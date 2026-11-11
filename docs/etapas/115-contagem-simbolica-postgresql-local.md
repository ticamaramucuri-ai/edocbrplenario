# 115 — Contagem simbólica em PostgreSQL local

**Estado:** L1 executada em PostgreSQL descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Repetir no PostgreSQL local a cobertura da contagem simbólica oficial, incluindo o empate, a revisão confirmada por outra identidade e duas propostas concorrentes usando a mesma versão.

## Ambiente e comando

- Container PostgreSQL local descartável, migrações versionadas, schema e dados sintéticos.
- Comando: `bun run test:postgres:foundation`.
- O runner executa as suítes PostgreSQL, gera cliente Prisma temporário e restaura o cliente SQLite ao final; o container e seus dados são removidos pelo trap de limpeza.

## Evidência

O runner encerrou com código zero. Na parte de contagem oficial, `attendance-commands.test.ts` e `symbolic-tally-official.test.ts` passaram: 6 testes e 58 assertions. Isso inclui as propostas simultâneas concorrentes: uma resposta 200, uma 409, uma revisão persistida, incremento único de versão e uma auditoria.

As demais suítes da fundação também passaram, incluindo concessão de autoridade, limite distribuído, fechamento oficial, prontidão, capacidade de votação, serviços PostgreSQL e ensaio de transferência concorrente. O log final confirmou DDL, backup/restauração e 84 tabelas.

## Limites

As duas chamadas de contagem foram disparadas em paralelo contra handlers no mesmo processo Bun, embora usando PostgreSQL real e transações concorrentes. Isso não equivale a duas instâncias HTTP da aplicação; proposta entre servidores, corrida concorrente de confirmação e corrida proposta/encerramento continuam pendentes para um runner local multi-processo.
