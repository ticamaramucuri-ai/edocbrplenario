# 098 — Jornada de navegador da busca global e Analytics

**Estado:** L1 parcial executada · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Fechar uma parte da lacuna visual da etapa 097: exercitar a paleta global de busca no navegador e o download CSV do módulo Analytics, contra uma instalação descartável.

## Execução

Comando: `bun run test:search:analytics:browser` (requer build standalone já compilado e Chromium local). O wrapper cria SQLite temporário, aplica schema e seed, sobe o build standalone em porta isolada (3223 por padrão) e remove banco, WAL, log e processo ao sair. Playwright Chromium autentica com o usuário demo `tenant_admin`; a jornada cria uma matéria sintética pela API e uma sessão fechada com presença fictícia no SQLite para habilitar o ranking anual.

## Resultado observado

- A paleta “Pesquisa unificada” recebeu termo exclusivo da fixture, exibiu a ementa retornada pelo servidor e navegou para Matérias ao selecionar o resultado.
- Analytics carregou o gráfico de presença e exportou `presencas-2026.csv`.
- O arquivo foi lido localmente e conferido quanto ao BOM UTF-8, cabeçalho/separador semicolon, nome do parlamentar no ranking e notificação de sucesso.
- A API confirmou que a sessão sintética habilitou presença e que o ranking inclui o membro esperado.

Saída final do runner: `ok: true`, `synthetic: true`, browser `Playwright Chromium`.

## Limites e próximos casos

É uma jornada funcional com fixture sintética, não homologação de semântica contábil. Não cobre todos os papéis, estados de erro, filtros/anos pela interface, interações e tooltips de cada gráfico, acessibilidade completa da paleta, grandes volumes ou comportamento de download em outros navegadores. API, isolamento, RBAC e agregações têm cobertura complementar na etapa 097. Próxima expansão: filtros de ano e estados vazios/erro pela UI, papéis de leitura, e os demais módulos sem jornada visual.
