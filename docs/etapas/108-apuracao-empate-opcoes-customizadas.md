# 108 — Apuração integrada de empate com opções customizadas

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Verificar a apuração de opções regimentais em uma votação nominal real pelas rotas da aplicação, incluindo presença/quórum, votos registrados sob chaves próprias e empate persistido no fechamento.

## Execução

Comando: `bun run test:voting:policy`. SQLite temporário e seed de schema; o teste cria Câmara, administrador, operador, dois parlamentares presentes, sessão aberta e votação com opções `a_favor` e `contra`. Abre a votação pelo handler, lança um voto por opção pelo endpoint de votos e fecha com a versão atual.

## Resultado

Resultado: **4 pass, 0 fail, 32 expect calls**. A resposta do fechamento e o estado persistido indicaram `status: closed`, `resultStatus: empate`, `registeredCount: 2`, `presentes: 2`, `naoRegistraram: 0` e contagem customizada `{ a_favor: 1, contra: 1 }`.

O primeiro rascunho do teste esperava `registrados` dentro de `resultCounts`; a execução mostrou o formato vigente do contrato (`registeredCount` no objeto da votação e `naoRegistraram` na contagem). A asserção foi corrigida ao contrato existente e a suíte completa passou.

## Limites

O caso verifica empate em votação nominal e duas opções. Não cobre vitória por margem desigual, empate simbólico por contagens de mesa, impedimentos combinados com chaves customizadas ou regras regimentais específicas de cada Câmara; estas seguem na matriz de próximos casos.
