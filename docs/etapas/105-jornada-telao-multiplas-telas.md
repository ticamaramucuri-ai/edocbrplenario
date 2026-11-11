# 105 — Jornada local do telão em múltiplas telas

**Estado:** L1 parcial executada em build e banco SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Requisito e objetivo

Verificar que operadores autorizados conseguem alterar perfil do telão e que duas telas de navegador autenticadas separadamente recebem os comandos em tempo real. Exercitar também o congelamento e a retomada do quadro sem perder a apresentação correta.

## Ambiente e execução

- Ambiente: Linux local, build standalone já gerado, SQLite temporário inicializado com seed sintético e Playwright Chromium headless.
- Comando: `bun run test:speech:browser`.
- Fixture: sessão criada via API, abertura e check-in dos parlamentares do seed; duas janelas Chromium com login independente do mesmo operador.
- Arquivo alterado: `scripts/local-speech-browser.mjs` (a jornada já cobria Mesa/fala e PWA; agora inclui dois telões).

## Evidência observada

O operador comandou o perfil de boas-vindas e as duas telas exibiram nome de presidente/sessão. Ao mudar para presença, ambas mostraram o perfil de presença e quórum atingido; `GET /api/v1/display/command` confirmou `manualProfile: presenca` e `mode: live`. O comando congelar exibiu o aviso nas duas telas, e descongelar removeu o aviso em ambas.

Resultado do runner: `ok: true`, `synthetic: true`, `display.screens: 2`, `profileFanout: true`, `presenceQuorumVisible: true`, `freezeUnfreeze: true`. Na mesma execução passaram inscrição e condução de discurso pela UI, retomar/prorrogar/encerrar, e pedido de palavra pelo PWA móvel sem overflow horizontal.

## Limites e próximos casos

Os dois navegadores desta etapa usam a mesma instância SQLite local e o mesmo nó de tempo real; esta etapa não repete a perda física de rede, tela atrasada ao reconectar ou troca de sessão com quadro congelado. Fan-out em dois nós, tela tardia, reconexão e troca de sessão já têm evidência sintética separada na [etapa 045](045-ensaio-navegador-duas-telas.md), executada na stack PostgreSQL isolada de staging. Falta consolidar as duas coberturas numa regressão limpa e descartável. Ainda faltam validar o fluxo visual de comando pela Mesa (esta etapa envia os comandos pela API), todos os perfis, viewport 1080p/4K e acessibilidade do telão.
