# Etapa 087 — Matérias e protocolos

**Fase:** L1, processo legislativo e protocolo  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2, SQLite temporário via wrapper; `LEGIS_DEMO_MODE=true`; sem rede externa

## Incremento

Adicionei `tests/matter-protocol-flow.test.ts`, o wrapper `scripts/test-matter-protocol-flow.sh` e o comando `bun run test:matters:protocols`. A prova usa handlers reais e banco descartável.

## Resultado

```sh
bun run test:matters:protocols
```

**1 teste aprovado, 25 assertions, zero falhas.** Cobriu criação e numeração sequencial de matéria por tipo/ano, validação e RBAC, isolamento entre tenants, transições append-only da situação (inclusive terminal), detecção de sequência divergente, detalhe com timeline ordenada, registro e numeração de protocolo, distribuição com vínculo, arquivamento, anulação justificada e rejeição de transição após estado terminal.

Durante a escrita, as respostas efetivas foram usadas para fixar as expectativas: schema inválido retorna 422; ator com permissão geral, mas de outro tenant, recebe 403 por escopo.

## Limites e próximo passo

Ainda faltam testes locais próprios para tarefas/prazos, versões de matéria, relações, resultados/pareceres, busca/filtros, renderização de modelos e jornada visual. A evidência cobre somente os caminhos listados, não o módulo legislativo inteiro.
