# Etapa 096 — Retentativa de voto PWA após perda da resposta

**Data:** 10/11/2026 · **Estado:** executada localmente em build e banco descartáveis · **Comando:** `bun run test:pwa:plenary-browser`

## Objetivo

Verificar o caso ambíguo em que a API já gravou um voto, mas o parlamentar não recebe a confirmação por causa de uma queda de conexão. A retentativa deve conservar o mesmo voto e a mesma chave de idempotência, evitando duplicidade ou escolha acidental de outra opção.

## Falha simulada e percurso

Em uma votação nominal sintética no SQLite descartável, a parlamentar confirmou “Sim” no PWA. O interceptador Playwright encaminhou a primeira chamada `POST /api/v1/me/vote` ao servidor, recebeu resposta HTTP 200 e descartou essa resposta antes de devolvê-la ao navegador. Assim, o servidor já havia registrado o voto, enquanto o cliente observou uma falha de rede. A interface mostrou “A resposta do voto não foi confirmada” e ofereceu “Tentar novamente”.

A retentativa foi reenviada pela interface. O roteiro comparou o corpo das duas chamadas e confirmou `votingId`, opção e `commandId` iguais; em seguida consultou a votação pela sessão e confirmou **exatamente um** voto “Sim” para a parlamentar. A jornada continuou até o encerramento e a exibição do recibo no PWA.

Resultado observado: **passou**, duas tentativas de cliente, primeira resposta do servidor 200 antes da perda, chave idêntica e uma linha de voto persistida. O registro não chama um serviço externo; a interrupção é simulada localmente no navegador.

## Artefatos e repetição

- Script: `scripts/local-pwa-vote-browser.mjs`.
- Ambiente: wrapper descartável `scripts/test-pwa-vote-browser.sh`, SQLite temporário, seed e build standalone.
- Comando: `bun run test:pwa:plenary-browser`.

## Limites

O ensaio descarta a resposta na camada do navegador após uma resposta bem-sucedida; não simula perda de pacotes durante o transporte real, proxy reverso, desconexão Wi-Fi de dispositivo físico, suspensão do navegador nem uso concorrente de outro dispositivo. A repetição após rejeição do servidor (4xx), rate limit e resposta 5xx continua pendente.
