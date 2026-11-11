# 118 — Retentativa de voto PWA após 429, 503 e ACK perdido

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Cobrir a recuperação visual do voto no PWA quando o serviço limita a chamada, está indisponível ou grava o voto mas a resposta se perde, sem trocar a intenção nem criar um voto duplicado.

## Ambiente e comando

- Build standalone atual, Playwright Chromium headless e SQLite temporário criado/removido pelo runner.
- Comandos: `bun run build` e `bun run test:pwa:plenary-browser`.
- O runner preserva a jornada de check-in, voto com opção customizada, recibo, contagem simbólica oficial aprovada e empate simbólico pela Mesa.

## Evidência

Para uma mesma escolha, o navegador enviou quatro tentativas com o mesmo `commandId`: resposta sintética 429; resposta sintética 503; gravação real com HTTP 200 cuja resposta foi abortada; e repetição encaminhada ao servidor, que confirmou o comando idempotente. Depois do 429, a UI manteve as demais opções desabilitadas e exibiu a ação para retentar a intenção pendente. O estado final apresentou o recibo e a Mesa encontrou exatamente um voto registrado para a parlamentar.

Resultado: `ok: true`, `retryAttempts: 4`, `sameCommandId: true`, `retryableHttpFailures: [429, 503]`, `firstServerStatusBeforeResponseDrop: 200`, `recordedVotes: 1`, viewport móvel 390/390 px.

## Limites

O 429 e o 503 são respostas simuladas no navegador, antes de chegar ao servidor. O cenário prova a recuperação do cliente e a idempotência após ACK perdido, mas não valida o rate limiter real, a indisponibilidade real do banco/rede, backoff automático ou mensagens específicas para cada código HTTP. Esses ensaios seguem pendentes.
