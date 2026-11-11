# Etapa 093 — Jornada de navegador da fila de fala e cronômetro

**Data:** 10/11/2026 · **Estado:** executada localmente em build e banco descartáveis · **Comando:** `bun run test:speech:browser`

## Objetivo

Validar a integração visual/API do módulo Discursos em sessão aberta: inscrição de orador, fila, palco, controle do tempo e encerramento. O seed e os registros usados são sintéticos; nenhuma Câmara, sessão ou serviço externo é acessado.

## Preparação e percurso

O wrapper aplica o schema no SQLite temporário, roda o seed local e sobe o build standalone numa porta dedicada. O roteiro autentica um usuário fictício, prepara sessão não oficial e check-ins pela API e então percorre a interface em Chromium/Playwright:

1. inscreve uma oradora externa para Grande Expediente, com assunto e duração de 120 segundos;
2. inicia a fala, confirma palco/cronômetro, aguarda o acúmulo de tempo e pausa;
3. retoma e prorroga a duração em um minuto;
4. encerra por confirmação e confere a fala encerrada.

As consultas finais à API confirmaram a inscrição na fila, a duração inicial, pausa com tempo acumulado, fala retomada com duração de 180 segundos e estado final encerrado. Resultado observado: **passou**, `ok: true`, duração final 180 s e 2 s acumulados. A trilha de transições, auditoria e outbox já tem assertions no teste de domínio da [etapa 086](086-testes-locais-fila-e-cronometro.md); a rota de detalhe não expõe essa trilha e, portanto, esta evidência de navegador não afirma conferi-la.

## Artefatos e repetição

- `scripts/test-speech-browser.sh`: build standalone, SQLite isolado, seed e limpeza por trap.
- `scripts/local-speech-browser.mjs`: setup sintético por API, controles de fala pela UI e conferência de persistência por API.
- `package.json`: comando `test:speech:browser`.
- Reexecução nesta etapa: **passou**.

## Limites

Não mede audibilidade dos alertas sonoros, sincronização de cronômetro no telão, cliente PWA do parlamentar, comportamento em duas telas, concorrência nem todos os papéis. Também não cobre fila com múltiplos oradores, cancelamento ou cenários de falha. Esses casos permanecem explicitamente pendentes na meta local.
