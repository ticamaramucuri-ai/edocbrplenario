# 101 — Matriz local de tipos e autorização dos vínculos legislativos

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Completar casos que ficaram fora da etapa 100: exercício dos seis tipos aceitos pelo domínio e proteção de leitura/remoção em chamadas sem escopo ou permissão.

## Execução

Comando: `bun run test:matter:related-graph`. Mesmo runner isolado da etapa 100; fixture em SQLite efêmero e remoção do banco ao sair. A suíte verifica `altera`, `revoga`, `regula`, `subsidiaria`, `emenda` e `substitutivo`, além de leitura de vínculo fora do tenant, remoção por ator sem `matter.write`, remoção quando a matéria não participa do vínculo e ausência do parâmetro `relatedId`.

## Resultado observado

1 teste passou com 36 assertions. Os seis tipos foram criados e retornaram com o tipo solicitado. As quatro operações inválidas de leitura/remoção retornaram 403, 403, 404 e 422; a suíte confirmou que o vínculo válido permanece após as tentativas recusadas.

## Limites

A matriz confirma aceitação pelo contrato da API, sem homologar o significado regimental de cada tipo. A interface ainda mostra apenas uma classe criada visualmente (emenda); operações visuais de remoção e mensagens de erro, matriz completa de papéis, concorrência e caminho de profundidade máxima permanecem pendentes.
