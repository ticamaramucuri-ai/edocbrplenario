# 112 — Empate na contagem simbólica oficial

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Verificar o empate em uma contagem simbólica oficial com três opções: a contagem proposta e confirmada por identidades distintas deve fechar como empate, preservar as contagens e produzir um resumo que identifique apenas as opções empatadas.

## Ambiente e comando

- SQLite temporário criado e removido pelo runner; dados e Câmara sintéticos.
- Comando: `bun run test:plenary:official-increments`.
- A suíte executa os cenários de presença oficial e contagem simbólica oficial.

## Evidência

Na rota oficial, a Secretaria propôs `A favor: 2`, `Contra: 2`, `Adiar: 1`; a Presidência confirmou a revisão e a votação foi encerrada. O registro persistiu `resultStatus: empate` e as três contagens, com quórum atendido. O resumo do item da pauta ficou “Empate entre as opções mais votadas (2 votos “A favor”, 2 votos “Contra”).”, sem incluir “Adiar”.

A execução passou com 5 testes e 52 assertions nos arquivos de presença e contagem simbólica oficial. A suíte de políticas de votação passou com 5 testes e 41 assertions. `bun run build` compilou, executou a verificação TypeScript e finalizou a geração das páginas.

## Correção associada

`customResultSummaryPhrase` agora filtra as opções empatadas pela contagem máxima. Antes, um empate entre duas opções incluía no resumo qualquer outra opção com contagem positiva inferior.

## Limites

Este cenário de API cobre empate em maioria simples com três opções e quórum atendido. A interface Mesa para esse cenário está registrada na [etapa 113](113-empate-simbolico-oficial-pela-mesa.md). Empate com mais opções empatadas, ausência de quórum, concorrência da revisão, falhas de rede e demais regras ainda precisam de cobertura própria.
