# 104 — Jornada local de relatórios e minuta de ata

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Percorrer pela interface os dois documentos disponíveis em Relatórios — espelho da sessão e minuta de ata — e confirmar seleção da sessão, dados de presença, exportação JSON e acionamento de impressão.

## Execução e evidência

Comando: `bun run test:workflow:browser` (build standalone, Chromium local e banco SQLite temporário). A fixture criou uma sessão encerrada de 2098, parlamentar sintético, legislatura e mandato vigente na data da sessão, além do evento de presença. O mandato é necessário porque a Câmara de demonstração aplica roster deliberativo baseado em mandato e licença.

Playwright selecionou a sessão na tela Relatórios; o espelho exibiu identificação, localização e presença. O JSON baixado usou o nome esperado e continha a sessão e o parlamentar. A jornada abriu a aba Minuta de Ata, visualizou a minuta, conferiu abertura, local e presença; seu JSON preservou sessão e presença. Os dois botões “Imprimir / PDF” acionaram `window.print()` interceptado pelo navegador de teste. O endpoint do espelho também foi conferido antes da jornada visual para confirmar a presença derivada.

Resultado: `ok: true`, `synthetic: true`, Playwright Chromium; `mirrorJsonContainsAttendance: true`, `ataJsonContainsAttendance: true`, `printHandlers: 2`. O runner encerrou e limpou a instância e o banco descartáveis.

## Limites

O teste comprova o acionamento de impressão, não a composição visual de PDF nem a qualidade de impressão em plataforma física. A fixture tem uma sessão, um membro presente e não inclui pauta ou votação; permissões alternativas, minuta com alterações/editor, assinaturas e publicação completa seguem cobertas parcialmente por outras suítes e etapas. Continua pendente exercitar erros e estados vazios nas duas telas.
