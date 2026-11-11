# 099 — Jornada de navegador de versões e relacionamentos legislativos

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Percorrer pela interface o versionamento append-only do texto de uma matéria e o vínculo tipado entre matérias, confirmando em seguida o conteúdo persistido pelas rotas locais.

## Execução e evidência

Comando: `bun run test:workflow:browser` (requer build standalone e Chromium local). O runner prepara banco SQLite temporário, aplica schema/seed, inicia o app em loopback e remove processo e arquivos temporários ao finalizar. A jornada completa já existente para matéria, protocolo, tramitação e tarefa foi ampliada. Com tenant demo isolado, ela registra visualmente uma nova versão com texto e autor; depois vincula duas matérias sintéticas como tipo “Emenda” e registra notas.

Playwright confirmou versão nº 1, autor e texto integral pela tela e pelo endpoint de versões. A seção Relacionamentos exibiu o tipo e o identificador legislativo da matéria vinculada; o endpoint confirmou o alvo e o tipo. A mesma execução percorreu cadastro de matéria, protocolo distribuído, andamento “inclusão em pauta” e tarefa concluída, conferindo persistência pela API. Saída final: `ok: true`, `synthetic: true`, browser `Playwright Chromium`.

## Limites e próximos casos

Esta evidência cobre um vínculo de emenda e uma versão criada, não todas as seis classes de relacionamento, remoção/duplicidade/ciclo, histórico com múltiplas versões, concorrência, anexos, papel somente leitura ou erros da interface. As regras de versão e ciclo também exigem cobertura de API/domínio e papéis. Busca, modelos, parecer independente, anexos pela tela e demais estados visuais seguem pendentes.
