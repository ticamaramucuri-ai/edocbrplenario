# 117 — Corridas de confirmação e encerramento simbólico

**Estado:** L1/L2 executada em build local e PostgreSQL descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Completar o ensaio com dois processos HTTP independentes para cobrir confirmação concorrente de uma revisão e a disputa entre uma proposta simbólica e uma tentativa de encerramento sem confirmação.

## Cenários e evidência

Runner: `bun run test:postgres:foundation`. O teste usa o build standalone PostgreSQL da etapa [116](116-concorrencia-simbolica-duas-instancias-http.md), duas instâncias, login por cookie real e PostgreSQL descartável.

1. **Confirmação concorrente:** Presidência e administração enviaram `confirm` para a mesma revisão e versão ao mesmo tempo. Respostas `[200, 409]`; apenas uma identidade confirmou, uma auditoria de confirmação foi gravada e a versão avançou uma vez. Em seguida, a Secretaria encerrou por outra instância HTTP; a votação fechou usando a revisão confirmada.
2. **Proposta contra encerramento:** em outra votação aberta, uma instância propôs contagens enquanto a outra tentou fechar sem conferência. Respostas `[200, 409]`; permaneceu aberta, com uma única revisão pendente e versão atualizada. Nenhum fechamento não confirmado foi aceito.

Resultado emitido pelo runner: `confirmationStatuses: [200, 409]`, `closedWithConfirmedRevision: true`, `proposalCloseStatuses: [200, 409]` e `remainedOpenWithoutConfirmation: true`. `bun run test:postgres:foundation` terminou com código zero; os 6 testes/58 assertions da suíte de contagem simbólica passaram no PostgreSQL. Depois, a suíte SQLite passou novamente (6 testes/58 assertions). Container e diretório temporário removidos; verificações de sintaxe e `git diff --check` passaram.

## Limites

Dois servidores locais e duas chamadas por corrida, sem carga repetida ou partição de rede. Não cobre fila de retries após erro transitório, concorrência de três ou mais confirmadores, diferentes versões/regimentos, nem infraestrutura institucional.
