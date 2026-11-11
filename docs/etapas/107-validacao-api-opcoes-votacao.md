# 107 — Validação local da API de opções regimentais

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Completar o caminho feliz da etapa 106 com limites negativos e de fronteira no endpoint de criação de votação, garantindo que entradas inválidas sejam recusadas antes de gerar registros.

## Execução

Comando: `bun run test:voting:policy`. O script cria e remove um banco SQLite temporário, aplica o schema e executa `tests/voting-policy.test.ts` contra handlers locais. Foram executados três testes, com 26 assertions no total.

## Resultado

Cinco opções válidas foram aceitas e persistidas na ordem enviada; rótulos são aparados antes de gravar. Cada cenário inválido retornou HTTP 422, sem aumentar o número de votações da sessão:

- seis opções (o máximo é cinco);
- chaves repetidas;
- chave com maiúsculas fora do padrão permitido;
- rótulo composto apenas de espaços;
- rótulo com 61 caracteres (o limite é 60).

Resultado observado: **3 pass, 0 fail, 26 expect calls**, SQLite descartável.

## Limites

A API cobre os limites e não persistência. O diálogo da Mesa foi exercitado no caminho feliz da [etapa 106](106-jornada-votacao-opcoes-customizadas.md); ainda faltam testar por navegador as mensagens de validação, remover/adicionar até cinco opções, limite de tamanho em tela estreita, e distribuição de votos/empate entre diversas opções.
