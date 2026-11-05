# Changelog — Legis SaaS

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). O piloto está em
**0.x** (pré-1.0). Cada fase do prompt mestre entrega código funcional, migration, seed,
documentação e verificação reproduzível.

## [Não lançado] — Desenvolvimento contínuo

- Diagnóstico e plano de desenvolvimento revistos em 05/11: estado por capacidade, provas locais, gates institucionais, fila executável sem host e sequência de integração final com Nextcloud/Alfresco.
- Corrigido o cabeçalho em telas largas para iniciar após a barra lateral; o nome da Câmara no bloco institucional da sidebar ganhou leitura em múltiplas linhas, sem corte.
- Ensaio integral da réplica PostgreSQL repetido com as fotos de Mucuri: 78 tabelas e 526 linhas conciliadas, 14 imagens verificadas, jornada de escrita e recuperação HTTP concluídas no laboratório local.
- O ensaio de réplica PostgreSQL passa a auditar fotos e emblemas referenciados no snapshot antes da cópia; teste comprova recusa de imagem ausente.
- Importação reproduzível das fotos públicas dos 13 parlamentares atuais de Mucuri, com hash de origem, processamento WebP, isolamento por Câmara e proteção contra substituição de foto cadastrada.
- Mesa Diretora permite registrar eleição futura por Câmara com período e referência do ato, confirmar posse ou cancelar a eleição sem apagar o histórico. Datas civis são convertidas no fuso da Câmara; registros eleitos não assumem automaticamente. Testes cobrem colisões, repetição de eleição cancelada, auditoria e posse.
- Painel audiovisual destaca link publicado sem sinal/encaminhamento local confirmado e oferece retirada ao operador autorizado, com instrução de conferir a página externa.
- App do Parlamentar conserva o comando de voto quando a resposta se perde e oferece repetição da mesma tentativa. O servidor confirma voto já gravado após o fechamento da votação e rejeita reutilização da chave por outro ator/valor; testes preservam auditoria única.
- Portal ao vivo oculta o link de transmissão após o encerramento da sessão; o detalhe histórico preserva a referência da plataforma. Teste de publicação social cobre ambos os estados.
- Auto check-in do parlamentar reaproveita o UUID pendente após recarga da aba e envia a sessão esperada; mudança de sessão responde 409 sem presença indevida. Voto com chave idempotente reutilizada para outro valor responde 409. Testes cobrem repetição, isolamento, armazenamento bloqueado e auditoria única.
- A sonda agendada passa a ler `EDOCBR_PLATFORM_EMAIL` e `EDOCBR_PLATFORM_PASSWORD` do arquivo de ambiente da unidade systemd, além dos argumentos de linha de comando; teste comprova a consulta interna do scheduler por esse caminho.
- `platform/system-status` passa a medir o scheduler pela rede interna e a sonda externa o valida com credencial de plataforma; teste cobre processo sadio, degradado e ausente, sem abrir porta pública.
- Gateway Caddy da homologação encaminha app e WebSocket pela mesma origem; todas as portas publicadas ficam no loopback. Build do navegador não incorpora `127.0.0.1:3103`. Ensaio Chromium de três telas, dois nós, reconexão e acessibilidade passou pela porta 3181; teste de configuração impede publicação acidental via variáveis antigas. Host externo/TLS seguem pendentes.
- Matriz de falhas ganhou votação sintética contínua nos cinco cenários: sete votos, recibos e auditorias por cenário, chaves idempotentes repetidas e HTTP 503 observados na falha do banco e no corte de rede. Tentativas de teste interrompidas foram encerradas.
- Matriz de falhas agora exige outbox drenada e cadeia de auditoria íntegra após cada cenário; a prova local dos cinco cenários registrou zero pendências e cinco verificações válidas da cadeia.
- Matriz local agora lê continuamente a listagem pública durante cada falha; rejeita HTTP 200 sem lista válida e registra respostas saudáveis e degradadas por cenário. O ensaio observou 503 nas falhas de banco e manteve 200 nas falhas de tempo real, Redis e correio.
- Executor local da matriz de falhas reúne cinco cenários sintéticos em ordem, verifica evidência de cada um e confere a prontidão entre falhas. O cenário de correio agora para o worker, verifica fila pendente e entrega única após retorno. A prova JSON mantém explícitos observador externo e reinício de host pendentes.
- Roteiro de recuperação agora inicia uma segunda instância do app no banco restaurado e valida bootstrap, login e leitura autenticada; prova sintética com mídia conferiu 52 sessões e 1,494 s do início do contêiner ao primeiro bootstrap. Teste recusa manifesto adulterado.
- Sonda de saúde registra eventos JSONL de degradação e recuperação, com `incidentId` estável durante a falha; timer de exemplo persiste estado e eventos. Sequência conferida em servidor HTTP falso e no corte integrado da rede app↔banco; coleta e alerta em host externo pendentes.
- `/api/v1/health?ready=1` passa a medir acesso ao banco e responder 503 quando degradado; sonda remota consulta prontidão antes do bootstrap. Ensaio de corte confirmou transição 200→503→200 com sete votos concorrentes íntegros.
- Roteiro de falha de rede corrigido para manter a porta do app aberta ao isolar o PostgreSQL; sete votos concorrentes receberam HTTP 503, com sete recibos e auditoria após retorno. Timeout Prisma `P2024` classificado como `DATABASE_UNAVAILABLE`; observador externo pendente.
- App e serviços passam a expor `EDOCBR_BUILD_VERSION` em health; sonda remota registra a revisão de cada processo. A stack recebe `STAGE_BUILD_VERSION`; prova fora do host permanece pendente.
- Em 04/11/2026, iniciado o plano integral de conclusão: matriz de rastreabilidade de fluxos, código, testes, evidências e gates; README, ROADMAP e índice de etapas apontam para a revisão atual. O pré-voo somente leitura de Mucuri continuou `automaticReady: false`, sem criar dados oficiais.
- Matriz de falhas induzidas: seis cenários com o que deve acontecer, o que invalida o ensaio e qual roteiro existente cobre cada um; achado de que o cenário de perda de rede entre app e banco não tem ensaio e que reinício de contêiner não é reinício de host.
- Verificação de saúde feita de fora da instalação: sonda do app e dos serviços alcançáveis, leitura do `platform/system-status` para os que não ficam expostos, acordo de relógio pelo cabeçalho `Date` e recusa explícita (saída 2) de serviço que não pôde ser verificado; agendamento por timer de sistema. Execução contra host separado segue pendente.
- Topologia da homologação em contêiner documentada (`deploy/staging/README.md`) com serviços, volumes duráveis, segredos e o que falta provar fora do host; portas publicadas ficam no loopback.
- Carga concorrente de jornada, telão e portal: 13 parlamentares votando, dois telões em nós distintos de tempo real, oito leitores do portal e congelamento durante a votação aberta. Observado: atraso de evento p50 419 ms / p95 671 ms, quadro congelado em 71,62 ms, zero evento perdido em 134 e zero erro HTTP; o detector de perda foi provado com queda induzida (31 eventos perdidos).
- Revisão em contexto novo do branch inteiro, com correção dos achados: backup do `--apply` chamado sem os argumentos obrigatórios, URL não-`file:` caindo na base de desenvolvimento, remoção alcançando Câmara desconhecida, guarda inerte em `bun test <arquivo>`, variável de tempo real inválida derrubando a tela, vigia não rearmado, rótulo quebrando a topbar, `--keep 0` apagando todo backup e auditoria de acessibilidade com a porta de desenvolvimento como alvo padrão.
- Limpeza dos 15 tenants sintéticos aplicada na base de desenvolvimento, com backup verificável e integridade conferida.
- Registrado que o projeto não tem VPS: desenvolvimento local, sem passo de deploy.
- Pacote de validação institucional: cinco formulários de aceite (matriz regimental, composição da legislatura, canal de convocação, casos de presença/votação e ata/publicação) derivados dos campos que o código já exige, para a Câmara preencher escolhendo.
- Acessibilidade de presença, votação (três estados), telão em 1920×1080 e 3840×2160 e app do parlamentar em 390×844, com gate axe sem violação `critical`/`serious` e percurso por teclado de check-in a apuração.
- Contraste corrigido: selos `emerald-600`/`amber-600` com texto branco, texto das cores vivas do sonner no tema claro e texto secundário do telão.
- Guarda de banco como preload da suíte: teste com `DATABASE_URL` apontando para `db/` falha antes do primeiro caso.
- Limpeza de tenants sintéticos com simulação por padrão, percurso do grafo de chaves estrangeiras e transação com `defer_foreign_keys`.
- Execução sem gateway Caddy: `realtimeEndpoint()` decide o endereço do tempo real e a conexão sem resposta em 15 s vira estado visível na topbar.
- Câmara sem usuários explicada no gate de acesso (`actorsEmptyReason` no bootstrap).
- Senha para todos os perfis de demonstração do seed, com gate dos sete papéis.
- Retenção dos backups locais com simulação por padrão e runbook §5.1/§5.2.
- `CLAUDE.md` do projeto com stack, comandos conferidos, deploy (campos a definir) e regras.
- Leases de workers PostgreSQL para outbox, webhooks e scheduler; testes de concorrência e retomada.
- Rate limit público/API key compartilhado no PostgreSQL com advisory lock e hash da identidade.
- Migrações 0005–0006 e cópia conciliada de 71 tabelas em ambiente descartável.
- Pacote verificável de banco e arquivos, com ensaios de restore SQLite/PostgreSQL e detecção de adulteração.

## Etapas 043–044

- Linha de base documental/CI alinhada ao estado v0.13.0 e registro de pendências por fase.
- Emblema canônico por partido e Câmara com propagação aos parlamentares, migração PostgreSQL 0004 e backfill SQLite.
- Raiz de imagens configurável e auditoria/limpeza conservadora de órfãos.

## Etapa 042

- Cadastro e edição de parlamentares com foto e emblema do partido opcionais, prévia e remoção.
- Imagens exibidas nos cartões, na presença e no telão (presença, discurso e resultado nominal público).
- Upload com permissão, isolamento por Câmara, normalização WebP e migração PostgreSQL 0003.
- Procedimento e limites operacionais em [`etapas/042-imagens-parlamentares-telao.md`](etapas/042-imagens-parlamentares-telao.md).

## [0.13.0] — Onda 5 (Fases 21–24): prontidão para produção, confiança de acesso, ecossistema de API e crescimento do SaaS

Fechamento da Onda 5 com **34/34 tasks concluídas**: o sistema alcança **26 módulos**,
**~92 grupos de rotas** e **25 ADRs entregues** (001–025), com **4 mini-serviços**
(realtime :3003, webhooks :3004, **scheduler :3005** e gateway Caddy). A Onda 6
(Fases 25–28) passa a ser a próxima onda **planejada** (`docs/ROADMAP.md` §14).

### Adicionado (Fase 21 — Prontidão para produção)
- Modelo `ScheduledJob` (singleton por `kind ∈ alert.scan|export.watchdog|
  health.check|tenant.health_snapshot`) + rotas `/api/v1/platform/schedules`
  (GET `platform.read` — owner e suporte), `POST /platform/schedules/:id/run`
  e `PATCH /platform/schedules/:id` (`platform.manage`; `everySeconds` mín. 60s →
  422). A execução manual grava `lastRunAt/lastStatus/lastNote/updatedBy` na
  própria linha e **NUNCA adianta `nextRunAt`** (critério de aceite); decisões de
  agendamento ficam fora da cadeia de auditoria de tenant (padrão `SystemStatus`).
- **Mini-serviço scheduler** (`mini-services/scheduler`, porta **3005**, tick de
  30s): varre jobs vencidos e executa os kinds — `alert.scan` (faturas vencidas
  > 3d, sessão ≤ 48h sem pauta, webhooks em dead-letter → `PlatformAlert`
  deduplicada), `export.watchdog` (job `running` > 10 min → `failed` + alerta
  `export.orphan`), `health.check` (ping de 3003/3004 + banco) e
  `tenant.health_snapshot` (captura diária do health score). HTTP próprio:
  `POST /jobs/:kind/run` e `GET /health`.
- **Validação de ciclos** em `POST /matters/:id/related`: DFS bidirecional no
  grafo de relacionamentos → **422 `MATTER_CYCLE`** com `extra.path` em rótulos
  ("REQ 127/2026 → REQ 128/2026 → REQ 127/2026").
- **Watchdog de exportações** com reprocessamento: `POST /api/v1/platform/
  exports/:id/requeue` (`platform.read` — owner e suporte; job `failed` →
  `pending` + reprocessamento em background + ack do alerta `export.orphan` +
  auditoria `platform.export_requeued`). Fecha a pendência do job órfão da Onda 4.
- CI `.github/workflows/ci.yml`: `bun install` → `prisma generate` →
  `bun run lint` (gate) → `tsc --noEmit` (informativo) → `db:push` + seed →
  smoke das rotas públicas. UI: seção **Agendamentos** no Console → Sistema
  (com "Rodar agora" via confirmação) e card **Watchdog de exportações** no
  Suporte da Plataforma.

### Adicionado (Fase 22 — Confiança de acesso e assinatura eletrônica)
- **MFA TOTP nativo** (RFC 6238, `node:crypto`, sem dependência extra):
  `POST /auth/mfa/setup` (segredo pendente + `otpauthUrl` — exibido UMA vez),
  `/enable` (código TOTP → `mfaEnabled` + auditoria `user.mfa_enabled`),
  `/disable` (exige senha + código; segredo é **zerado** do banco) e
  `GET /auth/mfa/status`. Login por senha com MFA ativo → **401
  `MFA_REQUIRED`** sem sessão; `POST /auth/login/mfa` completa o segundo passo
  (falhas sempre 401 genérico). LoginForm em **dois passos** com `input-otp`.
- **Sessões ativas**: `GET /auth/sessions` (próprias, com `lastUsedAt` e
  `current` por cookie) e `DELETE /auth/sessions/:id` (revogação individual
  idempotente; encerra impersonação carregada). Card **"Meu acesso"** no módulo
  Usuários com MFA + sessões + revogar.
- **Assinatura eletrônica de atas** (ADR-023): cadeia de hash por documento
  (`docHash = sha256(conteúdo)`, `prevHash` encadeado, código HMAC por Casa);
  `POST /me/ata/sign` **idempotente** por (documento, parlamentar) — assina a
  ata publicada da última sessão **encerrada** em que o parlamentar teve
  presença (auditoria `ata.signed`; a assinatura atesta presença, o voto secreto
  permanece sigiloso); `GET /reports/session/:id/ata/signatures` (painel com
  elegíveis, pendentes e `chainValid` por recompute); **ata pública**
  `GET /public/documents/ata/:sessionId?tenant=` e **verificação pública por
  código** `GET /public/documents/verify-signature?code=` (200 com `valid:
  false` para código inexistente; ata adulterada depois de assinada → inválida;
  rate 30/min/IP). UI: painel **Assinaturas** em Relatórios → Minuta de Ata,
  card **"Assinar ata"** no PWA e seção de assinaturas no Portal Público.

### Adicionado (Fase 23 — Ecossistema de API)
- Modelo `ApiKey` com chave **`legk_` + 24 chars** (persistidos: prefixo
  `legk_+8` e **sha256** — a chave completa nunca volta ao banco), escopos JSON
  e revogação append-only. Rotas `GET/POST /api-keys` e `DELETE /api-keys/:id`
  (RBAC nova **`apikey.manage`**, tenant_admin; escopo do próprio tenant;
  auditoria `apikey.created`/`apikey.revoked` sem a chave; DELETE idempotente).
- **Rotas externas** `GET /external/{matters,sessions,publications,calendar}`
  com `Authorization: Bearer legk_…`: escopo exigido por endpoint (ausente →
  **403 `FORBIDDEN_SCOPE`**), dados SEMPRE do tenant da chave (mesmo
  isolamento do `x-actor-id`), envelope paginado `{data, page, pageSize,
  total}` e views idênticas às do portal público; **rate limit 60 req/min por
  chave** → 429 `RATE_LIMITED` + `Retry-After`.
- **Playground in-app**: `POST /api-keys/playground` executa a consulta REAL
  por **delegação assinada** (`deleg_…` HMAC de 30s) — a chave nunca vai ao
  navegador e não é reconstruída (ADR-024). Módulo **Integrações & API**
  (Governança) com 3 abas: Chaves de API, Playground e Documentação
  (referência, envelope, Problem Details e limites para desenvolvedores) +
  guia do desenvolvedor na Central de Ajuda.

### Adicionado (Fase 24 — Crescimento do SaaS)
- **Self-onboarding**: `POST /public/onboarding` (público, rate **3/h/IP**;
  valida nome/cidade/UF/e-mail/slug → 409 `SLUG_TAKEN` quando ocupado) cria
  pedido `pendente`; `GET /platform/onboarding` (owner e suporte),
  `POST /platform/onboarding/:id/activate` (owner: cria tenant + owner com
  **senha temporária exibida 1×** + **trial de 14 dias** em uma transação,
  auditoria `platform.onboarding_activated`) e `/:id/reject` (nota 5–200 chars
  obrigatória, auditoria `platform.onboarding_rejected`).
- **Trial com bloqueio suave**: `Tenant.trialEndsAt` + banner no topbar
  ("Trial termina em N dias" / "Trial expirado — leitura liberada, gravação
  bloqueada"); guarda central no `actor.ts` — escritas de tenant com trial
  vencido → **403 `TRIAL_EXPIRED`**, leituras seguem liberadas.
- **Health score canônico** por tenant (`src/lib/server/tenant-health.ts`,
  fórmula única para rotas/seed/scheduler: sessões/matérias/logins/webhooks →
  buckets Saudável ≥70 · Atenção ≥40 · Risco <40) + `TenantHealthSnapshot`
  diário; `GET /platform/tenants/health` e `GET/POST /platform/tenants/:id/
  health` (POST = captura forçada, `platform.manage`).
- **Métricas e NPS**: `GET /platform/metrics` (`platform.read`): tenants
  ativos, MRR (só assinaturas `active` — trials não contam), churn 90d,
  trials e **NPS da versão atual**; `GET/POST /help/nps` idempotente por
  (usuário, versão) — a partir desta versão o NPS avalia a **0.13.0**. Módulo
  **Crescimento** (Administração: métricas, saúde por tenant, fila de
  onboarding) e widget NPS na Central de Ajuda.

### Alterado
- Sidebar/⌘K com **26 módulos**: **Integrações & API** (Governança) e
  **Crescimento** (Administração) entregues nesta versão.
- **Flip do roadmap para v0.13.0**: Onda 5 marcada **entregue (34/34 tasks
  concluídas)** no módulo Planejamento e Roadmap — progresso 100%, badge
  "entregue na v0.13.0", meta 26 módulos/~92 grupos de rotas/25 ADRs, documentação
  **16 entregues/0 planejados** e aba Onda 6 apontando para o ROADMAP §14;
  versão-alvo passa a **v0.14.0 (Onda 6 — Fases 25–28, planejada)**.
- `TenantView.trialEndsAt` no bootstrap (alimentação do banner de trial);
  login real revalida o bootstrap do usuário autenticado (ver Corrigido).

### Corrigido
- **Card "Assinar ata" do PWA inalcançável**: o cartão mirava a sessão-alvo de
  `context.session` (que prefere sessões futuras agendadas) e nunca encontrava
  ata publicada; agora mira a **última sessão ENCERRADA** — mesma semântica do
  `POST /me/ata/sign` (encontrado no E2E da Task 37; re-verificado).
- **Bootstrap pós-login desatualizado**: o login real não rebuscava o
  `['bootstrap']`, mantendo white-label/banner de trial do tenant default
  pré-login; agora `handleLoggedIn` invalida a query antes de fechar o gate
  (re-verificado com o banner "Trial termina em 5 dias" + white-label da Serra
  Azul após login da Marta).
- **Guarda de `actorId` obsoleto agressiva no `Boot`**: a validação limava o
  ator de sessão recém-autenticado em troca de tenant (o gate reabria apesar de
  sessão válida); agora o clear é **pulado enquanto a query de bootstrap está
  revalidando** (`isFetching`) — login cross-tenant estável (re-verificado).

### Documentação
- **ADRs 022–025 entregues** (prontidão para produção · confiança de acesso e
  assinatura eletrônica · ecossistema de chaves de API · crescimento do SaaS) —
  pacote soma **25 ADRs**.
- `docs/api-contract.md` com a seção das Fases 21–24 (rotas, RBAC, erros novos
  `MFA_REQUIRED`/`FORBIDDEN_SCOPE`/`TRIAL_EXPIRED`/`MATTER_CYCLE`, rate limits
  e eventos de auditoria); manual do usuário (seção 11), Central de Ajuda
  (help-content 0.13.0), README, runbook e relatório de testes desta entrada.
- `docs/ROADMAP.md` **§14 (Onda 6 — Fases 25–28 planejada)** consolidado no
  fechamento da Onda 5; §12 marcado entregue. ADRs **026–029 planejados**
  (export-worker/backup/FTS · identidade federada e cripto · multi-idioma/AA ·
  ecossistema amplo).

## [0.12.0] — Planejamento da Onda 5 e módulo "Planejamento e Roadmap"

### Adicionado
- Módulo **Planejamento e Roadmap** (24º; menu Administração, ícone Milestone, hint
  "Onda 5"): o plano de continuidade do produto consultável DENTRO do produto por
  qualquer papel autenticado — 5 abas: **Visão geral** (estatísticas, ondas entregues
  e próximos passos), **Onda 5 — Fases** (accordion F21–F24 com progresso rastreável
  por task), **Menus e páginas** (mapa-alvo TO-BE v5 de 26 módulos com estado
  existente/novo/estendido), **Documentação** (pacote documental entregue e planejado)
  e **Onda 6 (prévia)**. Sem dependência extra: mesma API, mesmo banco.
- Rotas `GET /api/v1/roadmap` (qualquer papel autenticado, INCLUSIVE `platform_owner`
  sem tenant — sem `resolveTenantScope`, mesmo padrão do GET `/help`) e
  `PATCH /api/v1/roadmap/tasks/:id` (RBAC `platform.manage`, apenas `platform_owner`;
  Zod enum de `status ∈ pendente|em_andamento|concluido|bloqueado`; idempotente; a
  alteração registra **autor (`updatedByName`) e horário (`updatedAt`) na própria
  linha** — artefato de plataforma fora da cadeia de auditoria de tenant, padrão do
  `SystemStatus`). Sem ator → 401; tenant_admin no PATCH → 403 `FORBIDDEN_ROLE`;
  status inválido → 422; task inexistente → 404.
- Modelos `RoadmapPhase` (code F21–F24, wave, name, period, objective, status, order)
  e `RoadmapTask` (phaseCode, title, detail, status, order, updatedByName?, updatedAt?;
  únicos por fase+ordem) — nível **PLATAFORMA, sem tenant**.
- `roadmapApi` no api-client (`content()`/`setTaskStatus()`), tipos `Roadmap*`
  (`RoadmapTaskStatus` + labels, `RoadmapTaskView`/`RoadmapPhaseView` com progresso,
  `RoadmapDeliveredWave`/`RoadmapMenuItem`/`RoadmapMenuGroup`/`RoadmapDocItem`/
  `RoadmapPreviewPhase`/`RoadmapContent`) no contracts e conteúdo versionado em
  `src/lib/server/roadmap-content.ts` (mesmo padrão do help-content, ADR-016): estado
  entregue das Ondas 1–4, mapa TO-BE v5, pacote documental (12 entregues + 4 planejados),
  prévia da Onda 6 e ordem de execução (Tasks 32–38).
- Seed: 4 fases e **34 tasks** da Onda 5 espelhando o ROADMAP §12.1–12.4 (F21 8 ·
  F22 9 · F23 8 · F24 9), progresso inicial 0/34.

### Planejado
- **Onda 5 — Fases 21–24** (`docs/ROADMAP.md` §12): prontidão para produção
  (mini-serviço scheduler porta 3005 com tick de 30s, watchdog de jobs de export
  órfãos, varredura de alertas, validação de ciclos com 422 `MATTER_CYCLE`, índice
  de busca e CI), confiança de acesso (MFA TOTP nativo `node:crypto` com login em
  dois passos 401 `MFA_REQUIRED`, sessões ativas e **assinatura eletrônica de atas**
  com cadeia de hash verificável publicamente), ecossistema de integração (chaves de
  API `legk_` com escopos e revogação, rotas externas `/external/*` Bearer, rate
  limit 60/min/chave e playground in-app) e crescimento do SaaS (self-onboarding
  público rate limited, trial de 14 dias com bloqueio suave 403 `TRIAL_EXPIRED`,
  health score por tenant, `/platform/metrics` e NPS in-app idempotente).
- ADRs **022–025 planejados** (§8 do ROADMAP; entregues junto às fases): prontidão
  para produção · MFA/assinatura eletrônica · chaves de API · crescimento do SaaS.
- **Onda 6 — Fases 25–28** (§13, prévia de longo prazo): produção real (PostgreSQL+RLS,
  Redis, S3, SMTP, worker dedicado, CI completo), identidade federada e cripto de
  confiança (OIDC/SAML, voto secreto criptográfico, ICP-Brasil), multi-idioma e
  acessibilidade AA e ecossistema amplo (marketplace, Tauri offline, CKAN, GraphQL).

### Documentação
- ROADMAP §12 (Onda 5 completa: mapa TO-BE v5, modelo de dados/rotas/telas/critérios
  por fase, ordem de execução Tasks 32–38) e §13 (Onda 6); §8 com ADRs 022–025
  planejados e documentação viva nos módulos Ajuda/Planejamento.
- Manual do usuário, Central de Ajuda (help-content 0.12.0), README, runbook e
  relatório de testes desta entrada.

## [0.11.0] — Fases 17–20 (Onda 4): desfechos de matéria, recibos verificáveis, participação do cidadão e suporte/impersonação

### Adicionado (Fase 17 — Ciclo de vida da matéria)
- Modelos `RelatedMatter` (par único `(matterId, relatedMatterId)`; `kind ∈ altera|revoga|
  regula|subsidiaria|emenda|substitutivo`) e `MatterOutcome` (`kind ∈ sancao|veto_total|
  veto_parcial`, `actorName`, `date`, `notes?`, `dueAt?`) — fatos append-only. `MatterStatus`
  ganha `sancionado | vetado`. ADR-018.
- Rotas `/api/v1/matters/:id/related` (GET nas DUAS direções com `direction from|to`;
  POST/DELETE `matter.write` — 422 auto-referência/par duplicado em qualquer direção, 404
  alvo de outro tenant) e `/api/v1/matters/:id/outcomes` (GET/POST — sanção sobre `aprovado`
  ou promulgação após veto parcial; veto exige `notes`; mesmo kind do último → 422).
  `GET /api/v1/matters/:id` ganha `related[]` + `outcomes[]`; `GET /api/v1/public/matters/:id`
  publica o desfecho mais recente.
- Veto agenda `LegislativeTask` "Apreciar veto…" (prazo informado ou +15d às 19h) + `Proceeding`
  (`sanco`/`veto` com fromStatus/toStatus); a transição `aprovado → sancionado|vetado`
  ocorre EXCLUSIVAMENTE na transação do outcome, com auditoria `matter.outcome` (before/after).
- UI Matérias: badges Sancionada/Vetada (tabela e drawer) e `src/modules/matters/
  lifecycle-sections.tsx` com seções **Relacionamentos** (badge do kind, direção com seta,
  AlertDialog de desvincular, dialog "Vincular matéria" com pool filtrável) e **Desfecho**
  (timeline com prazo de apreciação em badge âmbar, dialog "Registrar desfecho" com opções
  desabilitadas conforme regras e justificativa obrigatória de veto no cliente).
### Adicionado (Fase 18 — Votação avançada)
- Modelos `VotingOption` (key slug/label/order; 1–5 por votação — substituem sim/nao/
  abstencao) e `VoteReceipt` (`receiptCode` + `payloadHash`, par único por votação/
  parlamentar). ADR-019.
- `src/lib/server/receipts.ts`: recibo determinístico HMAC-SHA256 por tenant
  (`computeReceipt`/`deriveTenantReceiptSecret`/`SECRET_VOTE_PLACEHOLDER`) — compartilhado
  entre seed e serviço; segredo de plataforma fixo no sandbox (produção: secret manager).
- `POST /api/v1/sessions/:id/votings` aceita `options?: [{key,label}]` (Zod: slug 2–40,
  label 1–60, sem duplicatas, máx 5); votos (`POST /votings/:id/votes` e `POST /me/vote`)
  validam `value` contra as chaves (422 com chaves válidas no field error); `/me/vote`
  responde `receiptPending: true` em nominal.
- Fechamento emite recibos na MESMA transação (`issueVoteReceipts`, upsert idempotente +
  auditoria `voting.receipts_issued`; secreto com `__SIGILO__` — participação sem valor) e
  apura multi-opção (`computeVotingResultAdvanced`: contagem por chave em
  `resultCounts.custom`, maioria simples/absoluta/unanimidade, empate, sem_quórum;
  simbólica com opções exige `customCounts`).
- Rotas novas: `GET /api/v1/votings/:id/receipts` (RBAC OR `audit.read` ∨ `voting.write`;
  recomputa o HMAC de cada voto → `{ok, recomputedCount, mismatchCount}` — mismatch inclui
  voto sem recibo/recibo órfão; 409 se não fechada; nunca expõe valores) e
  `GET /api/v1/me/receipts` (`self.vote`, últimos 60 — aba "Recibos" no PWA).
- UI: Mesa do Plenário com seção "Opções de resposta" (1–5 pares chave/rótulo com slug
  automático), painel "Recibos verificáveis" (selo verde/vermelho, código mono por
  parlamentar, "Reverificar"); Telão com rótulos por opção (chips e BigCounts); PWA com
  botões por rótulo e hint de recibo pendente.
### Adicionado (Fase 19 — Participação e confiança pública)
- Modelo `CitizenSubscription` (`tenantId`, `email`, `targetKind ∈ matter|session|hearing`,
  `targetId`, `token` único, `confirmedAt?`, `revokedAt?`; idempotente por
  `(tenantId, email, targetKind, targetId)`). ADR-020.
- Rotas `POST /api/v1/public/subscriptions?tenant=` (201 pending SEM token; dupla
  confirmação; e-mail normalizado trim+lowercase; alvo inexistente → 404),
  `GET /api/v1/public/subscriptions/confirm?token=` (idempotente, e-mail mascarado,
  404/409 revogada) e `GET /api/v1/public/verify?code=` (público global: `valida` /
  `revogada` / `nao_encontrada` — atas continuam verificáveis em Relatórios pela cadeia
  de auditoria).
- Gestão pelo tenant: `GET/DELETE /api/v1/subscriptions` (RBAC nova `subscription.manage`;
  `targetLabel` resolvido, `stats {total, confirmed, pending, byTarget}`, `confirmToken`
  apenas nas pendentes ativas — link copiável no sandbox sem SMTP; revogação grava
  `revokedAt` + auditoria `subscription.revoked`, idempotente).
- `src/lib/server/rate-limit.ts`: janela deslizante em memória por (bucket, IP) —
  **5/h assinaturas, 5/10min perguntas de audiência (aplicado no POST
  `/public/hearings/:id/questions`), 30/min verify**; 429 Problem Details (`RATE_LIMITED`,
  `retryAfterSeconds`) + header `Retry-After`.
- UI: Portal Público com aba **Acompanhar** (formulário e-mail+tipo+alvo, estados
  201/200-pendente/200-confirmada, card "Como funciona") e botão "Verificar autenticidade"
  com selo no detalhe da publicação; Publicações com aba **Assinaturas** (stats, tabela,
  "Copiar link de confirmação", Revogar com AlertDialog) e código de verificação copiável.
### Adicionado (Fase 20 — Operação e suporte)
- Modelos `SupportImpersonation` (`reason`, `expiresAt`, `startedAt`, `endedAt`),
  `PlatformAlert` (`kind`, `severity`, `message`, `actionHint`, `meta`, `ackAt?`, `ackBy?`)
  e `ExportJob` (`status pending|running|done|failed`, `progress`, `error?`);
  `AuthSession` ganha `impersonationId?`. Permissões novas `platform.read` e
  `impersonation.manage` (platform_owner, platform_support). ADR-021.
- Rotas `/api/v1/platform/impersonations` (GET histórico/alvos elegíveis + POST inicia —
  **exige cookie de sessão por senha** (409 para `x-actor-id`); motivo ≥10, prazo 5–60min,
  422 escalonamento para papéis platform; auditoria `support.impersonation_started` na
  cadeia do tenant-alvo) e `POST /:id/end` (encerra, limpa sessões, audita
  `support.impersonation_ended`, idempotente). `/api/v1/auth/me` devolve
  `actor.impersonation` (banner) — expiração lazy na leitura; logout encerra.
- Rotas `/api/v1/platform/alerts` (GET `platform.read`, máx 50) e
  `POST /api/v1/platform/alerts/:id/ack` (owner `platform.manage` — `ackAt/ackBy` +
  auditoria `platform.alert_acked`, idempotente); alertas derivados do system-status são
  persistidos deduplicados por kind aberto.
- Exportação assíncrona: `POST /api/v1/platform/tenants/:id/export` → **202 {job}** com
  worker in-process (etapas reais, progresso 0–100; falha → failed), guarda de 1 job por
  tenant (409), `GET` da mesma rota devolve o último job, `GET /api/v1/platform/exports/:id`
  (status) e `GET /:id/download` (só `done` — payload regenerado deterministicamente, shape
  do export síncrono, sem segredos; auditoria `platform.export_job_created` na criação e
  `platform.tenant_exported` no download).
- Módulo **Suporte da Plataforma** (23º; plataforma): saúde resumida, alertas ativos com
  ack (owner), "Operar como usuário" (motivo/prazo/AlertDialog) com histórico; banner âmbar
  sticky no topbar em TODOS os módulos com contagem regressiva e "Encerrar agora";
  Console→Sistema com "Alertas persistentes" (aberto/reconhecido + ack) e Console→Visão
  Geral com painel de exportação (Progress 0–100, polling 1s, Baixar exportação).
### Alterado
- **Export síncrono → job assíncrono**: `POST /platform/tenants/:id/export` agora responde
  202 com `{jobId}` e progresso real; o download regenera o snapshot no momento do pedido
  (antes: 200 com JSON montado na hora).
- **system-status**: RBAC `platform.manage` → `platform.read` (platform_support lê a
  operação; ack continua do owner) e a resposta ganha `platformAlerts[]` (abertos primeiro,
  máx 20) mantendo `alerts` derivados.
- `VoteRow`/`ResultCounts` estendidos: `VotingView.options?` (rótulos regimentais
  ordenados), `ResultCounts.custom` (contagem por chave), frase-resumo/notificação do
  fechamento com rótulos; `POST /votings/:id/transition` (close) exige `customCounts`
  em simbólica com opções.
- Seed: PL 49 vetado pelo Executivo (prazo +15d + task + proceeding veto), EM 12 emenda
  vinculada ao PL 44, PL 41 sancionado (outcome + proceeding + status), votação READY com
  opções regimentais (aprovar_envio/arquivar/adiar), recibos determinísticos dos 11 votos
  nominais do REQ 120, 5 assinaturas de cidadãos (4 Vila Nova — 3 confirmadas; 1 Serra
  Azul), 2 alertas (1 aberto, 1 reconhecido), 1 ExportJob done e usuário platform_support
  **João Prado** (joao.prado@legissaas.dev / `DemoLegis!2026`) com impersonação encerrada
  auditada (ticket #1042).
- Sidebar: 23 módulos (novo: Suporte da Plataforma [Administração]); Portal Público com
  aba Acompanhar (7 abas); Publicações e Audiências com aba Assinaturas (visível só com
  `subscription.manage`).
- Eventos de auditoria novos: `matter.outcome`, `matter.related`, `matter.related_removed`,
  `voting.receipts_issued`, `subscription.revoked`, `support.impersonation_started`,
  `support.impersonation_ended`, `platform.alert_acked`, `platform.export_job_created`
  (o `platform.tenant_exported` passa a ocorrer no download). Nenhum evento
  outbox/webhook novo e nenhum código em `ApiErrorCode` novo (429 montado como Problem
  Details `RATE_LIMITED` com `Retry-After`).
### Segurança
- Rate limit real nos endpoints públicos de escrita (429 + `Retry-After` demonstrável —
  5/10min perguntas, 5/h assinaturas).
- RBAC demonstrado: `vote.cast` nega não-parlamentares (tenant_admin Ana → 403 ao votar);
  `platform_support` recebe 403 em rotas `platform.manage` (overview/export/exports) e não
  pode reconhecer alertas (403 — só o owner); auditor lê recibos (200) e parlamentar não
  (403).
- Escalonamento bloqueado: impersonar `platform_owner`/`platform_support` → 422
  (escalation proibida); impersonação exige login por senha (409 no modo demo `x-actor-id`).

## [0.10.0] — Fases 13–16: Agenda/pesquisa, modelos de documento, Central de Ajuda e operação SaaS
### Adicionado (Fase 13 — Agenda Legislativa e pesquisa unificada)
- `GET /api/v1/calendar?year=&month=` (qualquer papel do tenant, escopo via
  `resolveTenantScope`): eventos do mês `{id, kind, title, date, status, meta, module}` com
  `kind ∈ session|hearing|committee_meeting|task_deadline` — tarefas apenas PENDENTES,
  audiências/reuniões canceladas fora; `module` destino para a navegação. ADR-014.
- `GET /api/v1/search?q=` (mínimo 2 caracteres): top-5 por seção — matérias, sessões,
  parlamentares e publicações — com as 4 seções sempre presentes; termo numérico casa
  número/ano; datas preservando o wall-clock do seed (UTC).
- Módulo **Agenda Legislativa** (Operação): grade mensal date-fns pt-BR (semana iniciando
  domingo), chips por tipo com ícone+cor+texto, filtros por tipo com contagens, painel
  lateral do dia com "Ir para…", navegação anterior/próximo/Hoje e próximos eventos (7 dias).
- **Command palette global** (⌘K/Ctrl+K ou botão "Pesquisar" na topbar, cmdk): navegação
  pelos 22 módulos + pesquisa unificada com debounce 300ms; ESC fecha; 100% teclado.
### Adicionado (Fase 14 — Modelos de documento versionados)
- Modelos `DocumentTemplate` (tenantId, name, kind ∈ ata_sessao|decreto|resolucao|portaria|
  edital|oficio, active, currentVersion) + `DocumentTemplateVersion` (version único por
  template, bodyMd, changeNote, authorName) — histórico append-only. ADR-015.
- Rotas `/api/v1/templates` (GET/POST — POST cria v1) · `/api/v1/templates/:id`
  (GET/PATCH com ações `edit | new_version | restore | activate | deactivate` — restore
  cria versão NOVA com corpo da anterior) · `/api/v1/templates/:id/render` (preview com
  contexto opcional `{sessionId?, matterId?}`; 12 placeholders; desconhecidos NÃO falham —
  retornam em `unresolved`).
- `POST /api/v1/publications` aceita `templateId` opcional → auditoria extra
  `template.rendered` na MESMA transação (origem da publicação rastreável).
- Módulo **Modelos de Documento** (Administração): tabela, dialog criar/editar com painel
  de 12 placeholders clicáveis (inserção no cursor), tabs Editor/Preview (react-markdown),
  histórico em timeline com restaurar e desativação com confirmação.
- Permissão nova `template.write` (tenant_admin, legislative_admin) — matriz server-side e
  espelho na store. Seed: 5 modelos Vila Nova + 1 Serra Azul (isolamento).
### Adicionado (Fase 15 — Central de Ajuda)
- `GET /api/v1/help` para qualquer papel autenticado INCLUSIVE `platform_owner` sem tenant
  (não usa `resolveTenantScope`): `{guides[], glossary[], faq[], shortcuts[], changelog[],
  about}` — 7 guias (um por papel), 26 termos de glossário, 12 FAQs, 5 atalhos, changelog
  0.1.0→0.10.0 e about com stack + índice de 25 documentos.
- Conteúdo versionado com o código em `src/lib/server/help-content.ts` (fonte única, sem
  banco — documentação viva que acompanha o release). ADR-016.
- Módulo **Central de Ajuda** (grupo novo "Ajuda", todos os papéis): busca local unificada
  sem acentos com contagem por aba e 6 abas (Primeiros passos com seletor de papel,
  Glossário, Perguntas frequentes, Atalhos, Novidades, Sobre).
### Adicionado (Fase 16 — Observabilidade, exportação e encerramento)
- `GET /api/v1/platform/system-status` (`platform.manage`, escopo global): health de
  3003/3004 com `AbortSignal.timeout(2000)` + latência (serviço parado degrada o card,
  NUNCA 500), tamanhos db + WAL, filas (outbox pendente + idade; webhooks pending/dead),
  atividade (tenants, sessões hoje, último audit), runtime (uptime, heap) e `alerts[]`
  derivados com ação sugerida. ADR-017.
- `POST /api/v1/platform/tenants/:id/export` (`platform.manage`): exportação INTEGRAL do
  tenant em JSON para download (Content-Disposition) — 24 entidades com aninhados, SEM
  passwordHash/secret de webhook/tokens de sessão, votos de votação SECRETA com `value`
  null (participação mantida), cadeia de auditoria incluída; auditoria
  `platform.tenant_exported`.
- `POST /api/v1/platform/tenants/:id/close` (`platform.manage`): zod
  `{justification ≥ 10, confirm: 'ENCERRAR'}` (422 field errors; 404 inexistente; 409 já
  desativado); transação: `active=false` + revoga TODAS as AuthSession do tenant +
  assinatura → `canceled` + auditoria `platform.tenant_closed` com justificativa. Dados
  NUNCA apagados (retenção LGPD + cadeia); reversível apenas por reativação auditada.
- Console da Plataforma: aba **Sistema** (3ª aba — banners de alerta com ação, cards por
  serviço/banco/filas/atividade/runtime, auto-refresh 30s + "Verificar novamente") e, na
  Visão Geral, ações por tenant **Exportar dados** (download + toast com tamanho) e
  **Encerrar** (AlertDialog com justificativa + digitação "ENCERRAR", botão travado até
  válido).
### Alterado
- Sidebar: 22 módulos (novos: Agenda Legislativa [Operação], Modelos de Documento
  [Administração], Central de Ajuda [grupo novo "Ajuda"]); Console da Plataforma com 3 abas.
- Publicações: dialog de criação com "Criar a partir de modelo" — render no SERVIDOR com o
  contexto dos vínculos escolhidos; placeholders não resolvidos avisam o usuário.
- Eventos de auditoria novos: `template.created|updated|version_added|deactivated|
  rendered` e `platform.tenant_exported|tenant_closed`. Nenhum evento outbox/webhook novo
  e nenhum código de erro novo (validações → 422 `VALIDATION_ERROR`; encerramento
  duplicado → 409 `CONFLICT_VERSION`).
- Central de Ajuda: correção pós-E2E no conteúdo (`webhook.write` → `webhook.manage`).

## [0.9.0] — Fases 9–12: Autenticação real, faturamento, publicações/participação e Analytics
### Adicionado (Fase 9 — Autenticação real)
- Login por e-mail/senha (scrypt) com sessão persistida (`AuthSession`, cookie httpOnly
  `legis_session`, 7 dias, revogável); resolução do ator em cascata cookie → x-actor-id.
- Gate de entrada único: formulário de login + perfis de demonstração (fim do auto-login);
  botão "Sair" no topbar.
- Enforcement de tenant desativado (`403 TENANT_INACTIVE`) — gap da Fase 8 fechado.
- Módulo **Usuários** (Administração): criar/editar, redefinir senha (revoga sessões),
  ativar/desativar; exclusão não existe (histórico). Papel parliamentarian exige vínculo.
- ADR-010. Senhas demo do seed: `DemoLegis!2026` (ana.ribeiro, carla.mendes, marta.lima,
  suporte@legissaas.dev).
### Adicionado (Fase 10 — Faturamento SaaS)
- Modelo `Invoice` único por tenant/período; "vencida" computada na leitura; numeração
  `0001/AAAA`; linhas = mensalidade + excedentes (parlamentares R$25/un, sessões R$40/un).
- Rotas `/platform/billing/*`: listar/gerar fatura, **ciclo do mês** (geração idempotente
  + dunning: assinatura past_due + notificação + webhook), pagar (reativa assinatura) e
  cancelar com justificativa auditada; `GET /platform/tenants/:id/usage` (uso vs. limites).
- Aba **Faturamento** no Console da Plataforma: KPIs (MRR, em aberto, vencidas, pagas),
  tabela com detalhe de linhas, ações e painel de uso por tenant. ADR-011.
### Adicionado (Fase 11 — Publicações e participação popular)
- Modelo `Publication` (diário eletrônico numerado por ano com código de verificação;
  draft→published→revoked, revogação nunca apaga) + `PublicHearing` + `HearingQuestion`.
- Módulo **Publicações e Audiências** (Governança): Publicações · Audiências · Moderação.
- Portal público com abas **Publicações** (pesquisa, conteúdo, selo "Revogada") e
  **Audiências** (AO VIVO/agendadas/encerradas + perguntas respondidas + **formulário do
  cidadão sem autenticação** — pergunta nasce `pending` e só aparece após moderação).
- LGPD por construção: authorEmail opcional e jamais serializado em rota pública. ADR-012.
### Adicionado (Fase 12 — Analytics/BI)
- Rota somente-leitura `GET /analytics/overview?year=` (KPIs, ranking de presenças,
  sessões/mês, matérias por status/tipo/autores, resultados, coesão partidária em
  votações NOMINAIS — secret excluída, fluxo de tramitação).
- Módulo **Analytics** (Governança) com gráficos (recharts/shadcn), ranking com barras de
  progresso e exportação CSV. ADR-013.
### Alterado
- Sidebar: 19 módulos (novos: Publicações e Audiências, Analytics, Usuários).
- Códigos de erro estáveis novos: INVALID_CREDENTIALS, TENANT_INACTIVE, EMAIL_TAKEN,
  INVOICE_INVALID_TRANSITION, INVOICE_DUPLICATE_PERIOD, PUBLICATION_INVALID_TRANSITION,
  HEARING_INVALID_TRANSITION, HEARING_QUESTIONS_CLOSED.
- Eventos outbox/webhooks novos: billing.* (3), publication.* (2), hearing.* (2).
- Erros 401 sem ator selecionado (gate aberto) não geram mais toast (ruído esperado).

## [0.5.0] — Fase 8: Console SaaS & Migração
### Adicionado
- Modelos `Plan`, `Subscription`, `MigrationRun`, `MigrationMapping`, `MigrationIssue`.
- Console da Plataforma (`platform_owner`): KPIs agregados, tenants com uso/health
  score/assinatura, onboarding completo de nova Câmara (tenant+legislatura+admin+trial),
  CRUD de planos.
- Entitlements por plano com gate real (`ai_assist` bloqueia rotas de IA fora do plano —
  402 `PLAN_LIMIT`).
- Importador do PainelDeskLegis 8.1: pipeline de 8 estágios (inspect→rollback) com
  validação de órfãos/duplicidades, transformação mapeada, import idempotente e
  retomável, reconciliação por contagens/amostras/checksum, relatório, homologação
  irreversível (digitação "HOMOLOGAR") e rollback auditado.
- Fonte legada sintética `upload/legacy/` + gerador `scripts/generate-legacy-export.ts`.
- 2º tenant demo (Câmara de Serra Azul) com dados coerentes — isolamento visível no
  console e no portal público (`?tenant=`).
- ADR-008; manual do usuário; runbook; guia do importador.
### Corrigido
- `GET /migration/runs/:id` ordenava issues por campo inexistente (500).
- Bootstrap agora lista equipe da plataforma (`platform_*`) no gate de atores.

## [0.4.0] — Fase 7: IA assistiva & App do Parlamentar
### Adicionado
- Modelo `AiArtifact` com rastreabilidade completa (input/output/modelo/provedor/revisor).
- IA assistiva backend (z-ai-web-dev-sdk, nunca no cliente): minuta de ata, sugestão de
  ementa + temas, resumo de tramitação, transcrição de áudio (ASR) e OCR (VLM) — com
  timeout, tratamento de erro do provedor e **revisão humana obrigatória** (aprovar/
  rejeitar auditado; IA nunca publica/vota/transiciona).
- App do Parlamentar (módulo `pwa`, mobile-first) + rotas `/api/v1/me/*`: contexto vivo,
  auto check-in (`source: pwa`, habilitável por tenant), **voto próprio com as mesmas
  garantias do operador** (presença, idempotência por commandId, alteração por política),
  entrada na fila de oradores e histórico pessoal.
- `TenantSettings.allowSelfCheckIn` (opcional, default true).
- Seções de IA em Relatórios (minuta com revisão) e no dossiê da matéria (ementa/resumo).
- ADR-006, ADR-009.

## [0.3.0] — Fase 6: Portal, dados abertos, notificações, webhooks e ata
### Adicionado
- Modelos `WebhookEndpoint`, `WebhookDelivery`, `Notification`.
- Portal público completo: pesquisa de matérias (filtros+cursor), detalhe público com
  tramitação, sessões históricas com pauta/presença/resultados, **dados abertos**
  (JSON/CSV por dataset, somente dados publicáveis) e sitemap.
- Notificações internas com sino no topbar (badge, popover, marcar lidas, navegação) e
  gatilhos transacionais (sessão, votação, tarefa, webhook dead).
- Webhooks: CRUD com segredo gerado, allowlist de eventos públicos, entregas com
  assinatura HMAC-SHA256 (`x-legis-signature`/`x-legis-timestamp`/`x-legis-event`),
  retentativa exponencial (5s→600s), dead-letter após 5 tentativas, teste e replay
  auditados; mini-serviço dedicado na porta 3004; eco local para demo.
- Minuta de ata estruturada (dados persistidos + código de verificação) em Relatórios.
- ADR-007.

## [0.2.0] — Fase 5: Estrutura institucional & processo legislativo
### Adicionado
- 15 modelos: partidos, blocos, mesa diretora com vigência, comissões (membros/reuniões),
  mandatos, afastamentos/suplências, tipos de matéria configuráveis, tramitação
  (append-only por seq), versões do texto, anexos, protocolo auto-numerado, tarefas/prazos.
- Máquina de estados da matéria (`em_tramitacao ⇄ incluida_pauta → aprovado|rejeitado|
  retirado`, terminais exigem anulação formal) — mudança de situação SOMENTE via andamento.
- Módulos **Estrutura Institucional** (5 abas) e **Protocolo e Tramitação** (3 abas);
  dossiê da matéria com timeline/versões/anexos; cartões de pendências no Painel.
- 14 grupos de rotas `/api/v1` com RBAC (`structure.write`, `protocol.write`,
  `task.write`), auditoria e eventos outbox novos (`matter.proceeding` público).

## [0.1.0] — Fases 0–4: fundação, sessão/votação, plenário, telão, portal, relatórios
### Adicionado
- Multi-tenant com white-label (cores, identidade), RBAC demo por `x-actor-id`
  (ADR-005), PostgreSQL→SQLite adaptado (ADR-001).
- Motor de sessão/votação (ADR-002): estados com pré-condições, concorrência otimista
  (`version`), idempotência de voto por `commandId` (dupla chave única), votação
  nominal/simbólica/secreta, snapshots de quórum, resultado determinístico, alteração de
  voto por política, anulação formal.
- Presença append-only com quórum em tempo real e check-in em lote.
- Discursos com cronômetro server-side (iniciar/pausar/retomar/+1min/encerrar).
- Tempo real outbox transacional → `mini-services/realtime` (3003) com salas interna e
  pública (ADR-003, emendado com serialização de escritas SQLite).
- Mesa do Plenário completa (presença/pauta/votação/discursos/comandos de telão) e Telão
  kiosk com perfis automáticos, snapshot de reconstrução e congelamento.
- Auditoria append-only com cadeia de hash verificável (ADR-004).
- Portal ao vivo, espelho de sessão com código de verificação, dashboard, parlamentares,
  matérias, configurações regimentais.
- 5 ADRs + contrato da API (`docs/api-contract.md`); seed com 2 legislaturas de história
  realista (13 vereadores, 25 matérias, 3 sessões).
[0.1.0]: #0110--fases-04-fundação-sessãovotação-plenário-telão-portal-relatórios
