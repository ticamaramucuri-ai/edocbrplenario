# Etapa 095 — Jornada do PWA para presença, voto e recibo

**Data:** 10/11/2026 · **Estado:** executada localmente em build e banco descartáveis · **Comando:** `bun run test:pwa:plenary-browser`

## Objetivo

Percorrer como uma parlamentar registra presença, vota e consulta o recibo nominal pelo aplicativo móvel. Preparação e atos administrativos de abertura são realizados por API no tenant fictício; o check-in, a escolha e a confirmação do voto e a consulta visual do recibo são executados pela interface PWA.

## Jornada e evidência

O wrapper aplica o schema em SQLite temporário, executa o seed e inicia o build standalone numa porta dedicada. O roteiro cria sessão não oficial e a coloca em credenciamento. Em viewport Chromium de 390×844, a usuária fictícia Carla Mendes:

1. confirma que o PWA está na sessão correta e registra seu próprio check-in;
2. aguarda a confirmação na interface e verifica que a presença consta no detalhe da sessão;
3. após a preparação sintética das demais presenças, a sessão é aberta e uma votação nominal fica pronta;
4. seleciona “Sim”, confirma a escolha e confere que a Mesa recebeu o voto nominal ligado à parlamentar;
5. após o encerramento administrativo da votação, abre “Recibos” e confere o código emitido;
6. confirma que a largura do documento permanece dentro dos 390 px do viewport.

Resultado observado: **passou**, `ok: true`; presença `presente`, voto nominal `sim`, recibo de 12 caracteres exibido no PWA e largura documental de 390 px. A consulta `/api/v1/me/receipts` e o detalhe da sessão serviram como provas de persistência independentes da renderização.

## Artefatos e isolamento

- `scripts/test-pwa-vote-browser.sh`: schema, SQLite efêmero, seed e servidor standalone em porta própria; remove banco/WAL/log e encerra servidor no trap.
- `scripts/local-pwa-vote-browser.mjs`: setup fictício por API e jornada Playwright do parlamentar.
- `package.json`: comando `test:pwa:plenary-browser`.
- Nenhum serviço institucional ou endpoint externo é chamado. O voto e o recibo pertencem só ao banco descartável.

## Limites

O caso cobre um parlamentar, uma votação nominal com escolha “Sim” e uma viewport móvel. Permanecem pendentes voto “Não”/abstenção e opções regimentais, votação secreta (bloqueada oficialmente), reenvio após falha de rede/ACK, alteração de voto conforme política, recibos de outros papéis, sincronização realtime e execução em aparelho físico. A criação/abertura/encerramento da sessão/votação é preparação API; esta etapa não os apresenta como jornada visual da Mesa.
