# Etapa 094 — Jornada do parlamentar no PWA para pedir a palavra

**Data:** 10/11/2026 · **Estado:** executada localmente em build e banco descartáveis · **Comando:** `bun run test:speech:browser`

## Objetivo

Exercitar o caminho do próprio parlamentar para solicitar a palavra no celular e confirmar que a fila pessoal reflete o que a Mesa recebe. A etapa amplia a jornada da [etapa 093](093-jornada-navegador-fila-fala-cronometro.md), sem substituir seus controles de Mesa.

## Jornada

No mesmo SQLite descartável, a preparação cria uma sessão não oficial, abre o credenciamento, registra presença sintética e abre a sessão. Após concluir a jornada de Mesa, um segundo contexto Chromium autentica a parlamentar fictícia Carla Mendes em viewport de 390×844 e percorre:

1. carrega o App do Parlamentar e confirma que o contexto selecionou a sessão aberta do ensaio;
2. abre “Pedir a palavra”, escolhe Grande Expediente e informa o assunto;
3. envia o pedido e confirma posição 1 na fila no PWA;
4. consulta o contexto pessoal e a sessão pela API, confirmando o pedido vinculado ao parlamentar, em estado `fila`;
5. mede a largura do documento e confirma que não excede o viewport móvel.

Resultado observado: **passou**, `ok: true`; a fila pessoal indicou posição 1, o pedido apareceu na sessão sob o nome da parlamentar e `documentWidth` = `viewportWidth` = 390 px. A sessão contém registros fictícios apenas e o wrapper remove o banco e o servidor ao terminar.

## Artefatos e limites

O roteiro é `scripts/local-speech-browser.mjs`; o wrapper `scripts/test-speech-browser.sh` mantém build standalone, banco SQLite temporário, seed e limpeza isolada. O comando único cobre Mesa e PWA.

Esta etapa cobre somente pedido de palavra pelo PWA. Check-in móvel, voto, recibos, atualização por tempo real, alternância de sessão, erros de rede e outros tamanhos/usuários permanecem pendentes. O teste não mede operação offline nem confirma homologação em aparelhos físicos.
