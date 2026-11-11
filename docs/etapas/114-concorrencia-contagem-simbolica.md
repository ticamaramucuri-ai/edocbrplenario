# 114 — Concorrência na proposta de contagem simbólica

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Verificar que duas propostas concorrentes para a mesma votação e versão não criam revisões paralelas nem avançam o estado mais de uma vez.

## Ambiente e comando

- SQLite temporário recriado e removido pelo runner; fixture oficial sintética com duas identidades de Secretaria, dois presentes e opções customizadas.
- Comando: `bun run test:plenary:official-increments`.
- O runner foi repetido três vezes após a asserção final de contagem vencedora.

## Evidência

As duas requisições `propose` foram disparadas juntas via `Promise.all`, ambas com versão 7 e contagens diferentes. Em cada execução, as respostas foram uma `200` e uma `409`; persistiu uma única revisão (`revision: 1`), com uma das duas contagens completas submetidas, a versão avançou somente para 8 e houve um único evento de auditoria `voting.symbolic_tally.proposed`.

Cada repetição passou com 6 testes e 58 assertions na suíte oficial. Portanto, o resultado foi observado três vezes com banco SQLite descartável.

## Limites

Este ensaio cobre duas chamadas concorrentes dentro de um único processo/runner SQLite. Não comprova bloqueio entre processos ou instâncias HTTP, nem comportamento PostgreSQL em carga. Confirmação concorrente, corrida entre proposta e encerramento e falhas transitórias também permanecem pendentes.
