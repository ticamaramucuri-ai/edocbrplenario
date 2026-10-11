# ADR-022 — Prontidão para produção: agendador, watchdog, ciclos e CI

**Status:** Aceito · **Data:** 2026-10-08 (Onda 5 / Fase 21) · **Contexto:** sandbox

## Contexto

A Onda 4 (v0.11.0) fechou com pendências explícitas no worklog (Task 31) que impediam o
projeto de ser chamado "pronto para produção": **alertas dependentes de leitura** (os
`PlatformAlert` só nasciam quando alguém abria o system-status — sem cron, um evento
grave à noite esperaria o primeiro acesso da manhã); **jobs de exportação órfãos** (o
worker é fire-and-forget in-process — restart no meio de um `running` deixa o job preso
para sempre, e a guarda 409 de concorrência persiste); **grafo de relacionamentos de
matérias sem validação de ciclos** (vincular A→B quando já existe B→A, ou fechar loops
longos, era aceito silenciosamente, corrompendo a semântica de altera/revoga/regula);
**ausência de esteira de CI** (nenhum gate automatizado de lint/tipos/smoke por commit) e
**busca unificada sem índice dedicado** (LIKE linear). Este ADR registra as decisões da
Fase 21 (ROADMAP §12.1) que fecham essas pendências no degrau executável do sandbox e o
caminho para a infraestrutura real.

## Decisão

1. **Mini-serviço `scheduler` (porta 3005, Bun, `--hot`)**: mesmo padrão dos serviços
   `realtime`/`webhooks` (acesso direto ao SQLite via `bun:sqlite`, WAL +
   `busy_timeout` + retries em `SQLITE_BUSY`, logging JSON, graceful shutdown). Modelo
   `ScheduledJob` com **singleton por `kind`** (`alert.scan`, `export.watchdog`,
   `health.check`, `tenant.health_snapshot`), `everySeconds`, `lastRunAt/lastStatus/
   lastNote`, `nextRunAt`, `active`, `updatedBy/updatedAt` (decisão de plataforma
   registrada NA PRÓPRIA linha — fora da cadeia de auditoria de tenant, padrão
   `SystemStatus`/RoadmapTask).
2. **Tick de 30s recalcula a agenda; execução manual NUNCA adianta**: a cada tick o
   serviço lê `active=1 AND nextRunAt <= agora`, executa os kinds vencidos e grava
   `lastRunAt/lastStatus/lastNote` **e** `nextRunAt = conclusão + everySeconds*1000`
   (um job falho registra `error` e mesmo assim avança — nunca dispara em loop
   apertado; erros são isolados por job). A execução manual
   (`POST /api/v1/platform/schedules/:id/run`, `platform.manage`) chama o scheduler por
   **HTTP interno** (`POST http://localhost:3005/jobs/{kind}/run`, timeout 10s;
   fora do ar → `503 SCHEDULER_UNAVAILABLE`) e grava apenas o resultado na linha —
   `nextRunAt` permanece intocado (critério de aceite explícito). Job pausado executado
   manualmente grava `skipped` + "Job pausado — execução manual informativa."
   `PATCH /platform/schedules/:id` (`platform.manage`, Zod, `everySeconds` ≥ 60 → 422)
   pausa/retoma/ajusta intervalo com `updatedBy` (nome do ator) na linha; o GET é
   `platform.read` (o suporte enxerga, o owner opera).
3. **Kinds com resultado concreto no `lastNote`**: `alert.scan` avalia faturas abertas
   vencidas há > 3d (por tenant), sessões `scheduled` sem pauta dentro de 48h e
   entregas de webhook em dead-letter (`status='dead'`) → `PlatformAlert` **dedupe por
   kind aberto + chave da meta** (`billing.invoice_overdue`+tenantSlug,
   `session.no_agenda`+sessionId, `webhook.dead_letter`+endpointId) — nota
   "Varredura: X condições avaliadas, Y alertas criados/existentes". `export.watchdog`
   marca `running` com > 10 min como `failed` + alerta `export.orphan` (meta jobId).
   `health.check` pinga realtime :3003 e webhooks :3004 (qualquer resposta HTTP =
   vivo; exceção = morto) + `SELECT 1` → alerta `service.degraded` (meta service) —
   nota "realtime ok · webhooks ok · db ok". `tenant.health_snapshot` captura o score
   CANÔNICO (fórmula importada de `src/lib/server/tenant-health` — imports `type`
   apagados em runtime, seguro sob Bun) **no máximo 1×/dia/tenant** — nota
   "2 tenants capturados (77/30)".
4. **Watchdog de exportações com reprocessamento no Suporte**: `GET
   /platform/exports` (`platform.read`) lista jobs `failed`/`running` com tenant;
   `POST /platform/exports/:id/requeue` (também `platform.read` — o
   `platform_support` opera o suporte) exige `failed` (422 caso contrário), reseta
   `pending/0/finishedAt=null`, reconhece o alerta `export.orphan` relacionado
   (meta jobId), audita `platform.export_requeued` na cadeia do tenant e dispara o
   reprocessamento real em background (mesmas etapas de contagem +
   `buildTenantExport`). Isso fecha o ciclo órfão: watchdog marca → suporte
   reprocessa → job conclui e o download volta.
5. **Validação de ciclos (DFS bidirecional, profundidade ≤ 50)**: `POST
   /matters/:id/related` percorre o grafo **não-direcional** de `RelatedMatter` do
   tenant (relacionamentos são recíprocos) DENTRO da transação de criação; se existir
   caminho `relatedId → … → id`, rejeita `422 MATTER_CYCLE` com `extra.path` em
   rótulos `tipo-número/ano` (ex. `['PL 47/2026', 'PL 49/2026', 'PL 47/2026']`). O
   duplicado direto (A→B com B→A existente) **é** ciclo — a busca de caminho cobre
   qualquer aresta pré-existente entre as pontas, substituindo a checagem de par
   duplicado isolada. O limite de 50 evita custo exponencial em grafos patológicos
   (grafo real: dezenas de nós).
6. **CI (`.github/workflows/ci.yml`)**: ubuntu-latest + `oven-sh/setup-bun@v2`;
   `bun install --frozen-lockfile` → `bunx prisma generate` → **`bun run lint` como
   gate principal** → `bunx tsc --noEmit` **informativo** (`continue-on-error` —
   divergências pré-existentes de `NextRequest`/`Request` em route handlers e globals
   Bun dos mini-services, documentadas no worklog; virará gate quando normalizadas)
   → banco efêmero do runner (`db:push` + seed com `DATABASE_URL` absoluto apontando
   para a cópia do checkout) → smoke com `bun run dev` em background aguardando
   `200` em `/api/v1/bootstrap` e
   `/api/v1/public/sessions?tenant=camara-vila-nova`, com upload do log do dev em
   falha.
7. **Índice de busca no sandbox**: o `LIKE` com prefixo (`termo%`) permanece
   satisfatório para a base demo; o caminho para produção usa `pg_trgm`/FTS (abaixo)
   — nenhuma migração de índice foi aplicada nesta fase (a tabela de matérias da base
   demo tem 30 linhas).

## Alternativas consideradas

- **Cron externo (crontab/systemd timers) chamando rotas de API**: exigiria
  autenticação de serviço dedicada e acoplamento HTTP por job; o poller do próprio
  serviço reutiliza o padrão realtime/webhooks (ADR-003) sem nova superfície de ataque.
- **Execução manual adiantando a agenda** (recalcular `nextRunAt` no run manual):
  destruiria a semântica de intervalo fixo ("rodar agora para testar" atrasaria a
  próxima execução automática); o contrato ficou explícito: manual = resultado na
  linha, agenda intacta.
- **Watchdog dentro da API Next.js** (setTimeout no processo do dev server):
  morreria com hot-reload/deploy a cada mudança de código; um processo dedicado
  sobrevive a restarts (`--hot`) independentemente do ciclo de vida da API.
- **Validação de ciclos por transação/recursão SQL (WITH RECURSIVE)**: SQLite suporta,
  mas a implementação com carregamento das arestas do tenant + DFS em memória é
  verificável, testável e independente de dialeto (portável ao PostgreSQL).
- **tsc como gate no CI**: bloquearia commits por erros pré-existentes fora do escopo
  desta fase; documentado como passo informativo até a normalização das fontes.

## Consequências

- (+) O SaaS opera sem depender de leituras: alertas de negócio, degradação de
  serviço, jobs órfãos e health score nascem em janelas fixas (5–10 min / 24 h) e
  ficam visíveis no Console (seção "Agendamentos") e no Suporte (card "Watchdog de
  exportações") com o estado REAL do banco (`lastRunAt`, nota concreta, status).
- (+) Ciclos de relacionamento são rejeitados com o caminho exato exibido ao usuário
  (UX de erro acionável); o grafo demo permanece acíclico e verificável.
- (+) Esteira de CI garante lint + banco + smoke a cada push/PR — regressões de
  contrato público (bootstrap/sessões públicas) falham o build antes do deploy.
- (−) O scheduler é single-instance (sem lock distribuído): em produção com múltiplas
  réplicas, duas instâncias executariam os mesmos jobs (idempotência via dedupe de
  alertas e guardas de update tornam isso benigno, mas o caminho correto é posse
  exclusiva — abaixo).
- (−) Execução manual e tick podem sobrepor o mesmo kind (sandbox aceitável: os kinds
  são idempotentes — dedupe de alertas, snapshot 1×/dia, watchdog é idempotente por
  job).
- (−) `tsc --noEmit` não bloqueia o CI (divergências pré-existentes documentadas) —
  a dívida permanece rastreada no worklog até normalização.

## Caminho de produção (registrado como meta, não implementado no sandbox)

1. **PostgreSQL + RLS** no lugar do `tenantId` aplicado em cada query: isolamento por
   política de linha (`USING (tenant_id = current_setting('app.tenant_id')::uuid)`)
   com `SET LOCAL` por transação — o código de domínio deixa de filtrar tenant
   manualmente e o isolamento passa a ser garantido pelo banco (defesa em profundidade
   contra falha de `assertTenantScope`).
2. **Redis** para rate limit (contadores distribuídos no lugar do in-process), filas
   (BullMQ) e dedupe de alertas/agendamentos (locks com TTL) — habilita múltiplas
   réplicas da API e do worker com segurança.
3. **SMTP transacional** (Postmark/SES) para double opt-in de onboarding/assinaturas
   e notificação ativa de alertas (pager/e-mail ao owner) no lugar das
   `Notification` apenas in-app.
4. **Worker dedicado com posse exclusiva da fila de export**: um único consumidor
   BullMQ retoma jobs `pending/running` após restart (checksum de heartbeat), o
   watchdog vira redundância de segurança e o requeue do Suporte enfileira em vez de
   disparar fire-and-forget in-process.
5. **Índice de busca `pg_trgm`/FTS**: GIN trigram para `LIKE '%termo%'` e/ou
   `tsvector` com ranking para a busca unificada (Fase 14) — no lugar do LIKE linear
   do SQLite; a UI de busca permanece inalterada (contrato `SearchView` estável).
