# 125 — PDF A4, seções da pauta e cadeia de auditoria

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 17/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo e escopo

Continuar a prova local dos relatórios do plenário: conferir a separação das fases da pauta, a legibilidade da paginação impressa e a integridade da cadeia de auditoria exibida no espelho. Papéis exercitados: operador autenticado na jornada de relatórios e dados sintéticos da sessão. Baseline do checkout: `3e029f7`; a correção final de impressão e este registro ainda estão no diretório de trabalho.

## Implementação e causa das falhas

- O espelho passou a apresentar Expediente, Ordem do Dia e Comunicações em seções próprias, com numeração e mensagens vazias locais. Antes, itens do Expediente apareciam sob “Ordem do Dia”.
- Os PDFs usam A4, margens próprias e rodapé “Página N de M”. A prova gera os arquivos reais pelo Chromium e lê tamanho, páginas e texto via Poppler. Foi acrescentada verificação de título de seção isolado no fim da página. A minuta apresentou “5. Discursos” sem o conteúdo na mesma página; uma regra CSS explícita inicia essa seção em página nova na impressão. A regra utilitária tentada inicialmente não apareceu no CSS compilado; a prova falhou e foi corrigida antes deste registro.
- A verificação da auditoria agora percorre os vínculos `prevHash`, identifica raiz ausente ou duplicada, bifurcação, evento órfão, ciclo e hash adulterado, mesmo que a ordem cronológica do registro seja diferente da ordem da cadeia.
- O seed fictício reconstruía eventos históricos fora da ordem de criação. Ao final do seed, a cadeia sintética é reencadeada por Câmara. A escrita normal permanece com busca direta do último evento. A jornada confere tanto o estado devolvido pela API quanto uma verificação independente dos eventos no banco.

Arquivos: `src/modules/reports/index.tsx`, `src/app/globals.css`, `src/lib/server/audit.ts`, `prisma/seed.ts`, `scripts/local-workflow-browser.mjs`, `tests/audit-chain.test.ts` e este registro. Contratos HTTP não foram alterados.

## Ambiente, fixture e execução

Linux, Bun 1.4.2, Next.js 16.1.3, Playwright Chromium, Poppler e SQLite temporário criado pelo runner. A sessão fictícia tem presença, 36 registros extensos de Expediente, 36 itens extensos de Ordem do Dia, votação nominal e marcador final. Há uma segunda sessão vazia e respostas 503 simuladas para os estados de recuperação. O runner remove o banco e encerra o servidor ao sair; os PDFs de revisão foram gravados apenas em `/tmp/edocbr-pdf-review/`.

| Comando | Resultado observado |
|---|---|
| `bun run build` | Passou, inclusive TypeScript e build standalone. |
| `REPORT_PDF_REVIEW_DIR=/tmp/edocbr-pdf-review bun run test:workflow:browser` | Passou após a correção da quebra. Espelho: 8 páginas A4; minuta: 5 páginas A4. Rodapés, marcadores finais, separação da pauta e ausência de cabeçalho isolado conferidos. |
| `DATABASE_URL=file:/tmp/edocbr-audit-chain-unit.db bun test tests/audit-chain.test.ts` | 3 testes, 5 assertions, 0 falhas. Abrange timestamps fora de ordem, adulteração, raiz ausente, bifurcação e cadeia vazia. |

Na jornada, a API e a verificação independente devolveram cadeia válida para 44 eventos sintéticos. As chamadas de lista, espelho e minuta recuperaram após 5, 3 e 3 tentativas, respectivamente. O teste de navegador também confirmou as demais funções já ligadas a essa jornada; esta etapa registra especificamente os relatórios e a auditoria.

## Limites e próximo critério

A prova usa o Chromium local e extração textual. Revisão visual página a página, impressora física, outros leitores PDF, falha do download JSON, retificação, aprovação e visibilidade completa no portal permanecem abertos. A regra `@page` vale para toda impressão da aplicação e precisa ser revista quando outros módulos ganharem documentos imprimíveis. A reconstrução da cadeia corrige somente o seed fictício; não altera eventos existentes de uma Câmara real.

Próximo critério: induzir falha de exportação JSON/download pela UI e conferir mensagem, recuperação e ausência de arquivo inválido; depois completar o fluxo de retificação e publicação no portal com papéis distintos.
