# Etapa 045 — Regressão do cabeçalho e menu por Câmara

**Data:** 05/11/2026. **Estado:** incremento local concluído; jornada navegável até publicação permanece na fila.

O roteiro `scripts/staging-a11y-audit.mjs`, executado por `bun run test:a11y:plenario` em build de produção e banco descartável, agora confere a identificação da Câmara em dois viewports. No desktop, o nome no cabeçalho deve começar após a borda da sidebar e o nome no bloco lateral não pode estar cortado. No móvel, o menu aberto deve mostrar o nome completo da Câmara. A base de demonstração fictícia evita usar o cadastro de Mucuri ou uma sessão oficial.

**Prova:** `bun run build` e `bun run test:a11y:plenario` passaram. Em 1366×768, a sidebar terminou em x=240 e o nome no cabeçalho começou em x=298; `sidebarNameClipped=false`. Em 390×844, `menuInstitutionNameVisible=true`. As oito telas do roteiro de acessibilidade tiveram zero violações impeditivas; o percurso por teclado de presença e votação passou. O ensaio continua sendo automatizado e não substitui conferência visual humana, TV física ou leitor de tela real.

**Próxima entrega:** ampliar a jornada navegável da Câmara fictícia até revisão/publicação da ata e conferência no portal, mantendo uma única trilha de evidência sem depender de canais institucionais.
