# 113 — Empate simbólico oficial pela Mesa

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Percorrer pela interface da Mesa uma contagem simbólica oficial customizada que termina empatada, mantendo a conferência independente da Secretaria e da Presidência e conferindo o resultado e o resumo na pauta.

## Ambiente e comando

- Linux local, build standalone, Chromium headless e SQLite temporário removido pelo runner.
- Comandos: `bun run build` e `bun run test:pwa:plenary-browser`.
- O runner executa o voto nominal customizado no PWA, a retentativa após perda da resposta, o recibo e dois fechamentos simbólicos oficiais pela interface.
- Câmara, políticas regimentais e dados usados são sintéticos. A aprovação da configuração é realizada pelos endpoints normais antes da criação da sessão oficial descartável.

## Evidência

Na segunda votação simbólica, a Secretaria lançou “A favor: 2”, “Contra: 2” e “Adiar: 1”. A Presidência, em outro navegador autenticado, confirmou a revisão e encerrou pela Mesa. A sessão retornou `resultStatus: empate` com as três contagens. Na aba Pauta, o resumo mostrou apenas as duas opções empatadas: “Empate entre as opções mais votadas (2 votos “A favor”, 2 votos “Contra”).”

Resultado do runner: `ok: true`, `synthetic: true`, `symbolicTie.result: empate`, `symbolicTie.closedViaMesa: true`; viewport móvel do PWA permaneceu em 390/390 px. O mesmo runner continuou passando check-in, voto customizado com retry idempotente, recibo e contagem simbólica aprovada `2 / 1`.

## Limites

Uma configuração de maioria simples, três opções e um empate entre duas delas. Não cobre empate com todas as opções, outras regras de maioria, proposta/confirmacão concorrente, indisponibilidade de rede durante a confirmação ou matriz completa de papéis. A fixture sintética não constitui validação regimental institucional.
