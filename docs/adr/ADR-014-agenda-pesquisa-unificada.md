# ADR-014 — Agenda Legislativa e pesquisa unificada como agregação somente-leitura

**Status:** Aceito · **Data:** Fase 13 · **Contexto:** sandbox

## Contexto

O prompt mestre exige calendários operacionais (§7.2) e o sistema até a v0.9.0 não tinha
nenhuma visão unificada de datas: sessões, audiências, reuniões de comissão e prazos viviam
em módulos separados. Também não existia busca interna — encontrar uma matéria, sessão,
parlamentar ou publicação exigia navegar module a module com os filtros locais. Os dados
todos já existiam em `Session`, `PublicHearing`, `CommitteeMeeting` e `LegislativeTask`; o
que faltava era ler junto, com escopo do tenant.

## Decisão

1. **Nenhum modelo novo** — a agenda é agregação somente-leitura sobre as quatro fontes
   existentes, materializada por requisição (`GET /api/v1/calendar?year=&month=`, qualquer
   papel do tenant com escopo via `resolveTenantScope`). Tarefas entram como
   `task_deadline` APENAS quando pendentes (concluídas não poluem o calendário);
   audiências e reuniões canceladas ficam de fora; cada evento carrega `module` destino
   para a navegação "Ir para…".
2. **Pesquisa unificada em uma rota** (`GET /api/v1/search?q=`, mínimo de 2 caracteres):
   top-5 por seção — matérias, sessões, parlamentares e publicações — com as 4 seções
   SEMPRE presentes no payload (vazias quando sem resultado), para o cliente renderizar
   grupos estáveis. Busca case-insensitive por `contains` (SQLite LIKE) sobre os campos de
   cada seção; termo numérico também casa número e ano ("43", "2026").
3. **LIKE sem índice, deliberadamente**: os volumes do sandbox não justificam índice
   textual — a busca roda sobre `findMany` filtrados por tenant, igual ao restante da
   leitura do produto.
4. **Command palette transversal** (cmdk) na topbar: abre com ⌘K/Ctrl+K ou pelo botão
   "Pesquisar"; grupo Navegação com os 22 módulos sempre visível sem busca + grupo
   Resultados consumindo `/search` com debounce de 300ms e mínimo de 2 caracteres; ESC
   fecha; seleção e Enter 100% por teclado. O diálogo é montado com Dialog+Command
   diretamente (`shouldFilter={false}`) porque o wrapper `CommandDialog` do shadcn não
   encaminha `value`/`shouldFilter` — o filtro fuzzy local escondia resultados do servidor.
5. **Wall-clock preservado**: a janela do mês é calculada em UTC e as datas/horas são
   exibidas sem conversão de fuso (`Intl` com `timeZone: 'UTC'`), coerente com o
   wall-clock institucional persistido pelo seed — evita deslocamento de dia/hora em
   meses limítrofes e fusos do Brasil.

## Consequências

- (+) Zero de schema/migration e zero risco de escrita; escopo derivado server-side como
  toda leitura do produto; palette serve de porta de entrada única para navegação e busca.
- (−) `contains` sem índice não escala para bases reais; o debounce existe apenas no
  cliente (cada caractere parado gera uma query); agenda limitada a um mês por chamada.
- (→) Produção: índice textual (SQLite FTS5 ou PostgreSQL `pg_trgm`/tsvector),
  rate-limit/debounce server-side na pesquisa e agenda paginada por períodos maiores
  (semana/trimestre) à medida que o volume de eventos crescer.
