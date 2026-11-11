# 120 — Pauta e votação nos PDFs dos relatórios

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Ampliar a jornada de relatórios para demonstrar que pauta, expediente e resultado de votação persistidos chegam ao espelho, à minuta, aos JSONs e aos PDFs impressos.

## Mudança e fixture

A fixture de relatório no roteiro `scripts/local-workflow-browser.mjs` agora cria um item de expediente, um item aprovado na ordem do dia e uma votação nominal encerrada com contagens e voto registrado. A UI e as exportações são verificadas por conteúdo da fixture. Chromium gera ambos os PDFs; `pdftotext` confirma sessão, presença, pauta, pergunta da votação, expediente e abertura da ata. A verificação anterior de ocultação dos controles de interface permanece ativa.

A presença do parlamentar também aparece no voto nominal; o seletor visual foi ajustado para aguardar a ocorrência de presença, evitando ambiguidade por texto repetido.

## Verificações

- `bun run build` — passou, incluindo compilação otimizada, TypeScript e geração de rotas.
- `bun run test:workflow:browser` — passou após o build, em Chromium e SQLite descartável. Resultado: JSON do espelho contém presença/pauta/votação; JSON da ata contém presença/expediente/votação; os dois PDFs renderizados contêm os dados esperados; controles de exportação/impressão não aparecem.
- `node --check scripts/local-workflow-browser.mjs` e `git diff --check` — passaram após a execução.

## Limites e próxima etapa

Dados sintéticos, uma sessão e um voto. Ainda não cobre múltiplas páginas, documentos volumosos, variações de quebra, estado vazio, erros de consulta/exportação, nomes longos e inspeção visual do PDF. Próximo: cobrir estados vazio e erro das telas e usar conteúdo longo para testar paginação e legibilidade.
