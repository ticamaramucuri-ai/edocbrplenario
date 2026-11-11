# Etapa 091 — Jornada de navegador do plenário e acessibilidade

**Fase:** L1/L4, presença, votação e telas públicas  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2, Playwright Chromium, build standalone local, SQLite e seed em arquivos temporários; sem staging ou serviço institucional

## Execução

```sh
bun run test:a11y:plenario
```

O wrapper `scripts/test-a11y-audit.sh` verificou a porta dedicada, criou banco/segredo temporários, aplicou schema e seed, iniciou o build standalone e limpou os recursos temporários ao final.

**Resultado:** sucesso (`ok: true`, `sintetico: true`). O navegador preparou rascunho e publicou pauta pela UI, conferiu layout desktop e móvel, percorreu check-in, abertura de votação, voto e apuração só com teclado e verificou a publicação no portal. Foram auditadas 8 telas: presença com quórum insuficiente e alcançado; votação aberta com parcial visível, encerrada e com parcial oculto; telão em 1920×1080 e 3840×2160; app parlamentar em 390×844.

O Axe não reportou violações impeditivas ou menores nas telas. O relatório somou 214 regras aprovadas e 18 regras inconclusivas nos oito scans; “inconclusiva” permanece como limitação da medição, não como aprovação dessas regras. A sequência de foco avançou por check-in, abrir votação, registrar voto, encerrar votação e confirmar apuração.

Na publicação observada, integridade foi verificada e o item ficou visível no portal sintético. O roteiro confirmou `draftViaUI: true` e `agendaPublishedViaUI: true`.

## Limites e próximo passo

Este ensaio cobre telas e atos selecionados de uma sessão de demonstração. Não comprova toda a UI, os componentes de fila de fala/cronômetro, duas telas físicas sincronizadas, reconexão após queda, comportamento offline, outros papéis/idiomas, Windows ou critérios de acessibilidade assistiva completa. Continuar com jornadas visuais de matérias, usuários/MFA, relatórios e transmissões, ampliando viewports e casos de erro.
