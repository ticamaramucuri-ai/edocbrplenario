# 109 — Vitória e resultado público com opções customizadas

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Verificar que uma opção customizada vence por maioria simples quando recebe mais votos que as demais e que o resultado e as contagens são apresentados pelo endpoint público da sessão.

## Execução

Comando: `bun run test:voting:policy`. SQLite descartável; o teste cria uma Câmara e sessão fictícias, três parlamentares presentes, votação nominal com opções “A favor” e “Contra”, dois votos na primeira e um na segunda. A votação percorre criação, abertura, registro e fechamento por handlers reais; em seguida a rota pública consulta o resultado pela identificação sintética da Câmara.

## Resultado

Suíte completa: **5 pass, 0 fail, 41 expect calls**. A rota de fechamento retornou `resultStatus: aprovado`, três votos registrados e contagem `{ a_favor: 2, contra: 1 }`. O GET público da sessão retornou o mesmo estado, resultado e contagens customizadas.

## Limites

O cenário cobre somente votação nominal customizada sob maioria simples, com resultado publicado enquanto a sessão de ensaio permanece aberta. Empate simbólico, contagem oficial de mesa, impedimentos, maioria absoluta/unanimidade com múltiplas opções, fechamento de sessão, votação secreta oficial e regras específicas de Câmara permanecem pendentes.
