# 119 — Renderização local dos PDFs de relatório

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Validar que os botões de impressão dos relatórios produzem documentos utilizáveis pelo fluxo de impressão do navegador, com dados da sessão e sem controles de interface, e registrar/corrigir conteúdo indevido no papel.

## Mudança

A jornada Playwright de `scripts/local-workflow-browser.mjs` agora renderiza a página em modo de impressão, gera um PDF com Chromium e extrai seu texto via `pdftotext`. Para espelho e minuta, exige sessão e presença; para a ata, também exige a seção de abertura. Verifica que controles de exportação/impressão não aparecem no PDF.

A inspeção detectou que o painel de assinaturas e notificações do Sonner apareciam no PDF da minuta. O painel foi marcado como não imprimível e a regra global de impressão passou a ocultar o toaster. A comparação da seção “1. Abertura” ignora espaços inseridos pelo mecanismo PDF na extração.

## Verificações

- `bun run build` — passou, incluindo compilação otimizada, TypeScript e geração de rotas.
- `bun run test:workflow:browser` — passou contra build standalone e SQLite descartável.
- Chromium criou PDFs dos dois relatórios; texto extraído confirmou sessão e presença; minuta confirmou abertura; os rótulos “Exportar JSON” e “Imprimir / PDF” ficaram ausentes.
- `node --check scripts/local-workflow-browser.mjs` e `git diff --check` — passaram após a execução.

## Limites e próxima etapa

Fixture sintética com uma sessão e um parlamentar. Ainda faltam pauta e votações no PDF, variação de volume/quebra de página, estados vazios/erros, visualização gráfica em múltiplas páginas e verificação manual em impressora/plataforma física. Próximo: ampliar a fixture do relatório com expediente, pauta e votação encerrada e conferir a preservação do conteúdo no PDF.
