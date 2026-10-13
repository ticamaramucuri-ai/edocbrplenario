# Etapa 045 — Acessibilidade automatizada da entrada e do telão

**Data:** 13/10/2026 · **Estado:** incremento técnico local concluído; ensaio assistido no plenário pendente.

## Achado e correção

A auditoria em Chromium encontrou contraste insuficiente na barra lateral da identidade edocBR: os títulos dos grupos tinham razão de aproximadamente 3,89:1 e o rótulo de conexão, 2,92:1 sobre o azul escuro. Ambos são texto pequeno, para o qual a verificação WCAG AA exige 4,5:1. Os títulos usam agora `text-sidebar-foreground/60`; o estado de conexão recebe cor própria da barra lateral, sem afetar seu uso no cabeçalho e em outros módulos. A auditoria local do diálogo de entrada, em temas claro e escuro, deixou de apontar essas violações. O perfil de pauta também revelou contraste insuficiente no rodapé (`text-zinc-600`); passou a usar `text-zinc-400` e o separador decorativo usa a cor de destaque da Câmara.

O ensaio de [navegadores e dois nós](045-ensaio-navegador-duas-telas.md) passou a executar axe-core com as regras WCAG 2 A/AA, 2.1 AA e 2.2 AA no diálogo de entrada claro e escuro, painel do operador e perfis do telão de boas-vindas, presença e pauta, incluindo pauta após mudança de sessão. Também exige que a saída do telão receba foco por Tab e funcione por Enter. Qualquer violação automática faz o roteiro falhar e lista as posições afetadas. As regras inconclusivas são registradas separadamente e não são consideradas aprovação.

## Verificação e limite

Reproduzir com `python3 scripts/staging-postgres.py stack-up` e `bun run test:staging:display-browser`. Em 13/10/2026 o ensaio passou com sete auditorias sem violação automática, três telas, dois nós e saída por Tab/Enter. Cada auditoria ainda informou uma ou duas regras inconclusivas, que exigem revisão humana. O cenário só usa o tenant fictício `staging-example`, dois nós locais e Chromium headless; a stack mantém os recursos de uma Câmara real intactos. `bun run lint`, `bun run typecheck` e o build PostgreSQL passaram.

A ferramenta automática não avalia a compreensão das mensagens, o uso real por leitor de tela, a legibilidade em TV distante nem a operação por parlamentar/servidor com tecnologia assistiva. A etapa 053 exige ensaio humano de teclado e leitor de tela, com registro dos achados e aceite da Câmara. Perfis de votação/presença com dados representativos e telas móveis ainda precisam de auditoria direcionada.
