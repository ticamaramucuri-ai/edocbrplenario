# 121 — Estados vazios e erros nas telas de relatório

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Eliminar skeletons indefinidos e distinguir lista vazia, erro ao consultar sessões, erro no espelho e erro na geração da minuta.

## Mudança

`src/modules/reports/index.tsx` agora apresenta estados explícitos para erro de sessões, ausência de sessões e falhas individuais no GET do espelho/ata. As falhas de consulta oferecem botão “Tentar novamente”; carregamento e vazio têm mensagens próprias em cada aba. O erro não é confundido com ausência de dados.

A jornada local verifica ausência de sessões nas duas abas e injeta HTTP 503 em cada consulta do espelho e da minuta. Após as duas tentativas automáticas falharem, o botão manual gera uma nova chamada e os dois documentos voltam a aparecer.

## Verificações

- `bun run build` — passou após a mudança de interface.
- `bun run test:workflow:browser` — passou em build standalone, Chromium e SQLite descartável. PDF/JSON com pauta e votação (etapa 120), abas sem sessões e recuperação do espelho/ata após 2 respostas 503 e uma terceira chamada bem-sucedida foram exercitados no mesmo fluxo.
- `node --check scripts/local-workflow-browser.mjs` e `git diff --check` — passaram após a execução.

## Limites e próxima etapa

A jornada confirma três chamadas por documento: duas respostas 503 (tentativa inicial e retry automático) e a terceira após clique manual, que recupera o PDF/minuta. Ainda faltam falha ao listar sessões, erro de exportação/download, estado sem minuta para sessão selecionada e paginação com conteúdo longo. Próximo: exercitar estado vazio de pauta/votações e conteúdo extenso com quebra de página.
