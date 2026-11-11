# Etapa 097 — Testes locais da busca unificada e Analytics

**Data:** 10/11/2026 · **Estado:** executada em SQLite descartável · **Comando:** `bun run test:search:analytics`

## Objetivo

Adicionar evidência direta para duas áreas sem teste nominal no inventário inicial: GET `/api/v1/search` e GET `/api/v1/analytics/overview`. O ensaio exercita handlers e banco real de teste, sem serviço remoto.

## Cenários verificados

### Busca unificada

- quatro seções sempre presentes, com matéria, parlamentar e publicação correspondentes;
- limite de cinco resultados por seção;
- busca por número/ano e rejeição de consulta com menos de dois caracteres;
- listas vazias quando não há correspondência;
- perfil autenticado de mídia também pode consultar a busca;
- a Câmara A não recebe matéria da Câmara B, e a Câmara B recebe apenas seu próprio registro para o mesmo termo.

### Analytics

- janela anual e mês das sessões, excluindo rascunhos;
- sessão realizada, percentual médio de presença e consolidação pelo último evento (presença seguida de saída conta ausente);
- total de matérias/autores e status aprovado;
- percentual de aprovação e contagem dos resultados, incluindo anulada;
- disciplina partidária somente para votos nominais, com empate no topo computado como zero alinhados e partido sem valor majoritário;
- duração média do ciclo de tramitação e intervalo por ação;
- tenant scope, consulta administrativa a outro tenant pelo `platform_owner`, negação de `media_operator`, ano inválido e KPIs nulos sem dados.

Resultado observado: **1 teste, 26 assertions passaram**. O mesmo conjunto confirmou que a votação secreta não entra no cálculo de disciplina partidária; o indicador agregado de aprovação segue o conjunto de votações fechadas, conforme a implementação.

## Artefatos e isolamento

- `tests/search-analytics.test.ts`: fixtures sintéticas em dois tenants e chamadas diretas aos handlers GET.
- `scripts/test-search-analytics.sh`: schema num SQLite temporário, `LEGIS_DEMO_MODE=true` e limpeza de banco/WAL no encerramento.
- `scripts/local-test-inventory.ts`: nova classe “Busca e analytics” para que o arquivo não fique sem classificação.
- `package.json`: comando `test:search:analytics`.

## Limites

Esta etapa testa rotas e agregações no banco; não percorre a paleta de busca global pela interface, exportação CSV, gráficos interativos, desempenho em volume, permissões de todos os papéis nem rótulos e acessibilidade visuais. Esses pontos continuam pendentes.
