# Relatório de Testes Executados — Legis SaaS (piloto)

> **Registro de uma execução anterior, não certificado do piloto atual.** Para status, CI e provas recentes consulte o [plano mestre](PLANO-MESTRE.md), a [matriz viva](MATRIZ-ENTREGA.md) e o [registro de etapas](etapas/README.md).

Testes **reais** executados no ambiente (curl sobre a API em execução, verificação de
navegação com agent-browser na origem do gateway, e leitura de logs). Nenhum teste listado
abaixo é simulado; falhas encontradas e corrigidas estão registradas em §3.

Ambiente: Next.js dev (porta 3000) + realtime (3003) + webhooks (3004), SQLite/Prisma,
base de demonstração re-semeada ao fim da verificação.

---

## 1. Backend — API `/api/v1` (curl, com `x-actor-id`)

### Fundação / sessão / votação (Fases 1–4, revalidadas neste ciclo)
- Bootstrap sem ator (gate de perfis) e com ator (escopo do tenant) ✔
- Transições de sessão: válidas ✔; inválida → 409 `SESSION_INVALID_TRANSITION` ✔;
  divergência de `version` → 409 `CONFLICT_VERSION` ✔
- Check-in com recálculo de quórum ✔; bulk de 8 presentes ✔
- Votação nominal: criar → abrir (com quórum insuficiente → 409 `QUORUM_INSUFFICIENT` ✔;
  com 8 presentes → aberta ✔) → votos → fechar com resultado determinístico e counts
  coerentes ✔
- Votação secreta: participação sem valor ✔
- 13 votos paralelos HTTP 200 em ~2,1s (sem perda/duplicação) ✔ *(Fase 4)*

### Fase 5 — Estrutura & processo legislativo
- GET legislatures/parties/blocs/board/committees/matter-types/leaves/mandates ✔ (dados seed)
- POST proceeding em matéria `aprovado` → 409 `MATTER_INVALID_TRANSITION` (terminal) ✔
- POST proceeding válido (`em_tramitacao→incluida_pauta`, seq 3) ✔ com auditoria e outbox
- Protocolo auto-numerado: POST 2× → números 9 e 10 sequenciais por ano/tenant ✔
- RBAC negativo: `session_operator` em POST /protocols → 403 `FORBIDDEN_ROLE` ✔
- Cadeia de auditoria com eventos novos: `verify=true` → `valid: true` ✔

### Fase 6 — Portal, notificações, webhooks
- `GET /public/matters?q=dislexia` → exatamente o PL 43 ✔
- `GET /public/sessions` → 3 sessões (statuses coerentes) ✔
- `GET /public/open-data?dataset=votes&format=csv` → `Content-Disposition` correto, CSV
  `;`+BOM, nominal público presente e **sem** nominal secreto ✔
- `GET /public/sitemap.xml` → XML válido ✔
- Notificações: broadcast admin ✔; unread por papel (operador vê 1) ✔
- Webhooks: POST como `session_operator` → 403 ✔; eventType fora da allowlist → 400 com
  lista válida ✔; criação → teste → **entrega success** (echo local, responseStatus 200)
  em ≤3s ✔; evento real `matter.proceeding` entregue automaticamente ✔

### Fase 7 — IA e PWA
- **LLM real** (glm-4-plus): ementa (2×), ata-draft (aprovada por Ana Ribeiro via review),
  proceedings-summary — artefatos persistidos com modelo/status ✔
- **ASR real** (glm-asr): transcrição persistida ✔ · **VLM real** (glm-5v-turbo): OCR ✔
- Review: aprovar → status `approved` + auditoria `ai.artifact_reviewed` ✔
- `/me/context`: parlamentar → sessão/presença/votação/fila ✔; admin → 403 ✔
- Fluxo PWA ponta a ponta (sessão de teste): open_checkin → **self check-in pwa** (200,
  quórum 1/13) → open_session → votação aberta (após quórum 8) → **voto SIM próprio** →
  mesmo `commandId` com valor diferente → voto mantido (idempotência) ✔ → close
  (aprovado, counts `{sim:1, nãoRegistraram:7, presentes:8}`) ✔ → anulação com
  justificativa ✔
- RBAC IA: `ai.use` conforme matriz (session_operator pode usar; revisão restrita) ✔

### Fase 8 — Console & migração
- `/platform/overview` e `/platform/tenants` como `platform_owner` → 2 tenants com uso e
  health score ✔; como `tenant_admin` → 403 ✔
- Onboarding via API e via navegador → tenant criado (3º) com trial ✔
- Migração (pipeline completo, 3 runs de teste):
  - inspect: 6 tabelas, 182 linhas ✔
  - validate: 169 validados / 13 rejeitados; 4 errors de órfãos detectados ✔
  - plan/dry_run: mapas e simulação com warns de nomes coincidentes ✔
  - import: 198 mappings; **re-import idempotente** (0 novos, 198 existentes) ✔
  - reconcile: `divergencias: 0` com contagens idênticas por tabela ✔
  - report: encerrado com finishedAt ✔
  - rollback (run de teste): removeu apenas dados do run ✔
  - homologate sem confirmação → 422; com "HOMOLOGAR" → true; **rollback pós-homologação
    → 409 `MIGRATION_HOMOLOGATED`** ✔

### Fases 9–12 (ciclo atual)

- **Autenticação (Fase 9)**: login com senha correta → 200 + cookie `legis_session` +
  ator ✔; senha errada → **401 genérico** ✔; `GET /users` **apenas com cookie** (sem
  x-actor-id) → 200 com escopo do tenant ✔ (prova da cascata cookie → header);
  `GET /auth/me` sem sessão → 401 ✔; auditoria `auth.login` gravada com cadeia válida ✔
- **Faturamento (Fase 10)**: `GET /platform/billing/invoices` com summary (MRR 59900,
  overdue 29900) ✔; ciclo → `{generated:2, skipped:0, dunning:0}` e **re-execução
  idempotente** `{0,2,0}` ✔; dunning end-to-end: fatura vencida da Serra Azul → ciclo
  `dunning:1` → assinatura trial→**past_due** + notificação "Fatura vencida" + webhook
  `billing.invoice_overdue` ✔; pagamento Pix → **paid + assinatura de volta a active** ✔;
  pay duplicado → 409 ✔; como tenant_admin → 403 ✔; `?status=overdue` filtra corretamente ✔
- **Publicações/Audiências (Fase 11)** (curl pelo subagente + main): rascunho invisível
  publicamente (404) → publish → pública com conteúdo + código de verificação ✔;
  re-publish/edit → 409 ✔; revogação com motivo curto → 422; válida → revogada com selo
  público ✔; numeração sequencial 0001→0002 ✔; **POST público de pergunta sem ator** →
  201 `pending` → **invisível no portal** → approve → **visível** → answer → resposta
  pública ✔; perguntas encerradas → 409 `HEARING_QUESTIONS_CLOSED` ✔; authorEmail **nunca**
  em rota pública ✔; isolamento entre tenants (404) ✔; 16 eventos de auditoria com
  **cadeia válida nos 2 tenants** ✔
- **Analytics (Fase 12)** (pelo subagente): overview 2026 com KPIs coerentes (1 sessão
  realizada, presença média 84,6%, 25 matérias/3 aprovadas, aprovação 66,7%, tramitação
  média 14 dias) ✔; coesão de 11 partidos calculada em votação nominal ✔; `year=abc` →
  422 ✔; sem ator → 401 ✔; platform_owner com `?tenant=` → dados do tenant 2 ✔; admin
  do tenant 2 isolado ✔; anos sem dados → vazio com nulls ✔

### Fases 13–16 (v0.10.0)

- **Agenda/pesquisa (Fase 13)** (subagente 22-a): `GET /calendar` do mês corrente → 200
  com 8 eventos coerentes e ordenados (reunião CCJ 20/08, audiência 20/08, sessão nº 1
  23/08, reunião CEC 26/08, prazos 28 e 29/08, audiência hoje 15h + sessão nº 2 hoje
  19h) ✔; 2026-09 → 7 eventos ✔; 2026-01 → `events: []` ✔; `month=13`/`year=2019` →
  **422** ✔; sem ator → **401** ✔; auditor (leitura) → 200 ✔. `GET /search`:
  `q=ata` (publicações), `q=saneamento` (REQ 127 + Edital), `q=Roberto` (matérias +
  vereador), `q=43` (PL 43/2026 por número) ✔; `q=x` e ausência de `q` → **422** ✔;
  sem ator → **401** ✔.
- **Modelos de documento (Fase 14)** (subagente 23-a + verificação do main):
  `GET /templates` lista os 5 modelos do seed (Ata v2, Decreto, Edital, Portaria,
  Ofício) ✔; `POST /publications` com `templateId` funcional — publicação de teste
  "0006/2026 (via modelo)" criada durante a verificação e removida no reseed ✔;
  auditoria `template.rendered` na mesma transação ✔.
- **Central de Ajuda (Fase 15)** (subagente 22-b): `GET /help` com ator tenant_admin →
  200 com as 6 chaves (7 guias, 26 termos, 12 FAQs, 5 atalhos, changelog 0.10.0→0.1.0,
  about com 25 documentos/6 itens de stack) ✔; sem ator → **401** ✔;
  `platform_owner` SEM tenant → 200 ✔ (prova que a ajuda não exige escopo de tenant).
- **Observabilidade (Fase 16)** (subagente 23-b): `GET /platform/system-status` como
  platform_owner → 200 (2 serviços OK com latência 14/10 ms, banco 819200 B + WAL
  4223032 B, filas zeradas, 2/2 tenants + 1 sessão hoje + último audit, runtime,
  `alerts: []`) ✔; com assinatura past_due temporária o alerta **info** apareceu e
  sumiu após restaurar ✔; tenant_admin → **403** ✔; sem ator → **401** ✔.
- **Exportação integral (Fase 16)**: `POST /platform/tenants/:id/export` Vila Nova →
  200 (112 KB, `Content-Disposition` `legis-export-camara-vila-nova-20260830-2229.json`)
  — NÃO contém `passwordHash`/`secret`/`scrypt` ✔; counts com 33 chaves coerentes (7
  usuários, 13 parlamentares, 25 matérias, 3 sessões, 22 votos, 39 eventos de auditoria)
  ✔; cadeia `prevHash→chainHash` consistente ✔; **sigilo do voto secreto validado com
  votação secreta temporária criada via Prisma** (3 votos com `value: null` e
  `parliamentarianId` preservado, depois removida) ✔; sem ator → **401** ·
  tenant_admin → **403** · tenant inexistente → **404** ✔.
- **Encerramento seguro (Fase 16)**: confirm errado → **422** field errors ✔;
  justificativa curta → **422** ✔; tenant inexistente → **404** ✔; tenant_admin →
  **403** ✔; close válido (Serra Azul) → 200 `{ok, message}` ✔; usuário do tenant →
  **403 `TENANT_INACTIVE`** ✔; close duplicado → **409** ✔; assinatura → `canceled` ✔;
  cadeias de auditoria VÁLIDAS nos 2 tenants após tudo ✔; reativação via PATCH → 200
  e acesso do usuário restaurado ✔ (assinatura restaurada manualmente a trial —
  reativação auditada não reativa cobrança, por design).

### Onda 4 (v0.11.0 — Fases 17–20, curl dos subagentes + smoke do main)

- **Fase 17 — desfechos/relacionamentos** (subagente 28-a, atores Ana/auditor):
  `GET /matters/:id/related` do PL 44 → **1 vínculo** (EM 12, emenda, direction from) e
  `GET /matters/:id/outcomes` → **0**; EM 12 enxerga a mesma relação como `to` ✔;
  POST subsidiaria PL43→PL47 → 201; **duplicados (direta e inversa) → 422**, auto-referência
  → 422, outro tenant → 403, inexistente → 404, kind inválido → 422 ✔; veto sem notes
  → 422 campo; veto_parcial 201 (status→vetado + task +15d + proceeding) → duplicado
  422 → **sanção pós-veto-parcial 201 (status→sancionado)** → veto sobre sancionada 422
  ✔; público PL 49 traz outcome veto_total com dueAt (related não vaza) ✔; DELETE vínculo
  200 / re-DELETE 404 ✔; auditor lê (200) e parliamentarian 403 nas escritas ✔;
  auditoria `matter.related`/`matter.related_removed`/`matter.outcome` (before/after) ✔.
- **Fase 18 — opções regimentais + recibos** (subagente 29-a, Marcos/Carla/Helena):
  voto `sim` em votação com opções → **422 chave inexistente** (chaves válidas no field
  error) e `adiar` → 200 ✔; criação com options → 201, key/label inválidos, 6 opções e
  duplicadas → 422 ✔; fechamento nominal custom (7 votos 4/2/1) → aprovado com
  `resultCounts.custom` correto ✔; `GET /votings/:id/receipts` → `ok=true recomputed=7
  mismatch=0` ✔; **recibos da v1 do seed → ok=true, 11 recibos, 0 divergências**
  (determinização seed↔serviço comprovada) ✔; **TAMPER de um receiptCode → ok=false,
  mismatchCount=1** → revertido com reseed ✔; extras: secreto com placeholder batendo
  (ok 2/0), simbólico custom com customCounts (422 sem/erro, 200 válido), unanimidade →
  rejeitado, empate → empate, RBAC receipts parlamentar 403/auditor 200, 409 não
  fechada, `/me/vote` `receiptPending=true`, `voting.receipts_issued` na cadeia e
  idempotência da re-emissão (7→7 sem duplicar) ✔.
- **Fase 19 — assinaturas/verificação/rate limit** (subagente 28-b + re-verificação):
  POST `/public/subscriptions` → 201 pending SEM token; idempotente (200 mesmo id, token
  não reemitido); confirmada → 200; inválido → 422; alvo inexistente → 404 ✔; confirm →
  200 confirmed (e-mail **mascarado**), repetido already_confirmed, inválido 404,
  revogada 409 ✔; `/public/verify` → **válida/revogada/nao_encontrada** (200 sempre,
  código minúsculo+espaços normalizado) ✔; `GET /subscriptions` (Ana) → **4 assinaturas
  VN (3 confirmadas)** + stats + confirmToken só na pendente ✔; DELETE revoga com
  auditoria `subscription.revoked` e idempotente ✔; **rate limit: 6º POST de perguntas →
  429 + `retry-after: 600`; 6ª assinatura do mesmo IP → 429; IP distinto liberado** ✔
  (RBAC auditor 403 em subscriptions).
- **Fase 20 — suporte/alertas/export** (subagente 29-b): login João Prado
  (platform_support) → **200** com cookie de sessão ✔; `GET /impersonations` → 200
  (histórico + 7 alvos, nenhum platform_*) ✔; POST sem cookie → **409** (demo
  x-actor-id não impersona); reason curto/minutes 120/alvo platform_owner → 422 ✔;
  POST válido → **201**; `GET /auth/me` → ator **Ana Ribeiro** + banner completo ✔;
  `/matters` com a sessão → 27 matérias (escopo do alvo) ✔; 2ª impersonação → 422; POST
  end → 200 → me volta a João; end idempotente ✔; **expiração LAZY comprovada** (imp
  vencida → me devolve o suporte + imp encerrada); logout durante impersonação encerra ✔;
  system-status com João → 200 + platformAlerts (1 aberto, 1 reconhecido) ✔; **ack do
  João → 403; login owner + ack → 200** (ackBy setado) e re-ack idempotente ✔; export:
  POST → **202**, 2º POST imediato → **409** (guarda), polling → done 100, **download →
  200 JSON íntegro** (25 grupos; sem segredos; votos secretos null), download em running
  → 409 ✔; RBAC: **João em /platform/overview, POST export e GET exports/:id → 403**
  (platform.manage) ✔; auditoria na cadeia com support.impersonation_started/_ended,
  platform.alert_acked, platform.export_job_created, platform.tenant_exported ✔.
- **Lint/build**: `bun run lint` → **0 erros / 0 warnings** (todas as fases); `dev.log`
  sem erros de runtime nas sessões finais; base re-semeada ao fim de cada verificação
  (27 matérias, PL 49 vetado / PL 41 sancionado / PL 44↔EM 12 recriados).

### v0.12.0 — módulo Planejamento e Roadmap (curl do subagente 33-b)

- **GET `/api/v1/roadmap` com tenant_admin (Ana)** → **200** ✔: `meta` com 24 módulos,
  ~76 grupos de rotas, 21 ADRs e mini-services (realtime :3003, webhooks :3004,
  gateway); `delivered` com as 4 ondas (Fases 0–4, 5–8, 9–16, 17–20 com versões);
  `phases` com **F21 0/8 · F22 0/9 · F23 0/8 · F24 0/9 = 34 tasks** (todas
  `pendente`, sem autor/horário); `menuV5` com 6 grupos (Operação → Ajuda);
  `docs` com **16 itens** (12 entregues + ADRs 022–025 planejados); `wave6` com
  F25–F28; `execution` com 10 tasks (32–38) ✔.
- **GET `/api/v1/roadmap` com platform_owner (sem tenant)** → **200** ✔ (mesmo padrão
  do `/help` — o roadmap não exige escopo de tenant).
- **GET `/api/v1/roadmap` SEM ator** → **401** `UNAUTHENTICATED` (Problem Details) ✔.
- **PATCH `/api/v1/roadmap/tasks/:id` com tenant_admin (Ana)** → **403**
  `FORBIDDEN_ROLE` — "Papel \"tenant_admin\" não pode executar \"platform.manage\".
  Papéis permitidos: platform_owner." ✔ (RBAC server-side — esperado).
- **PATCH com platform_owner (owner do seed)** → **200** ✔: task da F21
  (`status: em_andamento`) com **`updatedByName: "Suporte Legis SaaS"` e `updatedAt`**
  preenchidos na própria linha (registro de plataforma, fora da cadeia de auditoria
  de tenant) ✔.
- **PATCH com status inválido** (`"feita"`) → **422** `VALIDATION_ERROR` com field
  error em `status` (enum documentado) ✔; **PATCH em id inexistente** → **404**
  `NOT_FOUND` ✔.
- **Revert** da task alterada para `pendente` (owner) → **200** ✔ (base devolvida ao
  estado do seed — 0/34).
- **Central de Ajuda (pacote 0.12.0)**: `GET /api/v1/help` com Ana → 200 com
  `about.version: "0.12.0"`, changelog interno com **0.12.0 no topo**, 7 guias
  (todos com passo novo citando o módulo Planejamento e Roadmap), **19 FAQs**
  (3 novas) e 29 documentos no índice ✔.
- **Lint**: `bun run lint` → **0 erros / 0 warnings** após a edição do
  `help-content.ts` ✔. E2E no navegador do módulo (abas, progresso e ciclagem de
  status) fica a cargo da Task 33-a/main (UI completa) — evidências aqui são de API.

## 2. Frontend — verificação com navegador (agent-browser, origem gateway :81)

### Onda 4 (v0.11.0 — E2E do main, base re-semeada)

- **Sidebar/módulos**: **23 módulos** na sidebar (Suporte da Plataforma em Administração)
  ✔; mobile 390px sem overflow, hamburger com os 23 módulos, footer fixo ✔.
- **Matérias (Fase 17)**: drawer do **PL 49** com seção **Desfecho** — Veto total,
  prazo de apreciação e badge **Vetada** ✔; drawer do **PL 44** com **Relacionamentos**
  (EM 12 emenda) e botão **"Vincular matéria"** ✔.
- **Portal Público (Fase 19)**: aba **Acompanhar** → assinatura criada com estado
  **pendente** + toast ✔; Publicação → **"Verificar autenticidade"** → selo **VÁLIDA** ✔.
- **Plenário (Fase 18)**: sessão de hoje conduzida inteira no navegador — credenciamento
  → **check-in geral (quórum 13/7)** → abrir sessão → votação REQ 121 com **3 opções
  regimentais (Aprovar e encaminhar/Arquivar/Adiar)** → votos → Encerrar e apurar →
  **Aprovado** → painel **"Recibos verificáveis — Verificação OK, 7 recibos conferidos"**
  com códigos HMAC e **Reverificar** ✔; Ana (tenant_admin) recebeu **403** ao tentar
  votar (RBAC `vote.cast` correto — negação sem quebrar a tela) ✔.
- **Suporte da Plataforma (Fase 20)**: login por senha **João Prado** → saúde resumida
  (socket.io 65 ms, webhooks 39 ms, banco/filas/runtime) ✔ → alerta aberto (fatura
  Serra Azul) ✔ → **"Operar como Ana"** com motivo ticket #1042 → **banner âmbar
  "(João Prado) operando como Ana Ribeiro … termina em 30 min … Encerrar agora" visível**
  → encerrou → voltou a João ✔.
- **Console da Plataforma (Fase 20)**: **Exportar dados** → job **"Gerando 85%"** →
  **"Concluído 100%"** + **Baixar exportação** ✔; aba Sistema **"Alertas persistentes —
  2 abertos · 1 reconhecido"** → **Reconhecer** → **1/2** + toast ✔.
- Console do navegador: **sem erros** nas visitas ✔; `bun run lint` (pós-documentação)
  → 0 erros.

### Fases 13–16 (v0.10.0)

- **E2E do main (pós-integração, base re-semeada)**: gate + perfil demo → **22 módulos
  na sidebar** ✔; Agenda (grade agosto/2026, filtros com contagens Sessão 2/Audiência
  2/Reunião 2/Prazo 2, células "20 de agosto — 2 evento(s)", painel do dia com "Ir
  para…", próximos eventos) ✔; ⌘K (navegação com 22 módulos agrupados; busca "ata" →
  seção Publicações com 1 resultado) ✔; Central de Ajuda (guia do admin com 6 passos +
  chips, Novidades com 0.10.0 "Atual") ✔; Modelos (5 do seed, dialog com 12
  placeholders + Editor/Preview) ✔; Publicações ("Criar a partir de modelo" → corpo
  preenchido com render no servidor: "Vila Nova, 30 de agosto de 2026" resolvido,
  `{{sessao.*}}` pendente até o vínculo) ✔; Console → Sistema (2 serviços Operacional
  17/8 ms, banco 800 KB + WAL 4,03 MB, filas zeradas, 2/2 câmaras, heap
  192,7/197,5 MB, "Nenhum alerta") ✔; ações Exportar/Encerrar com validações ✔;
  mobile 390px sem overflow (hamburger com os 3 módulos novos) ✔; console do navegador
  sem erros ✔; lint limpo ✔.
- **Agenda/palette (subagente 22-a)**: grade com chips nos dias 20/23/26/28/29/30 e
  contagens nos filtros (2/2/2/2) ✔; painel do dia "Ordinária nº 2/2026 · 19:00 ·
  Agendada · Plenário" + "Ir para…" navegando ✔; navegação set/2026 reconta filtros
  (1/1/2/3) e "Hoje" volta ✔; próximos eventos com 7 itens (incluindo setembro via 2ª
  query) e cards que navegam ✔; mobile 390px sem overflow horizontal ✔; palette:
  Ctrl+K abre com 22 itens de navegação, "saneamento" → REQ 127/2026 + Enter →
  Matérias ✔, "Roberto" + 2×Seta ↓ + Enter → Parlamentares ✔, "zzzz" → vazio ✔, 1
  caractere mantém navegação ✔, ESC fecha e limpa a busca na reabertura ✔.
- **Central de Ajuda (subagente 22-b)**: guia tenant_admin com 6 passos + 8 chips ✔;
  busca "quorum" → contagens por aba (Primeiros passos 4 / Glossário 2 / FAQ 1)
  ✔; glossário agrupado por inicial ✔; accordion FAQ ✔; tabela de atalhos ✔; timeline
  com 7 versões (0.10.0 "Atual"/30-08-2026) ✔; Sobre com stack e 25 documentos ✔;
  seletor de papel troca o guia ✔; chip "Mesa do Plenário" navega ✔; login como
  platform_owner → guia "Operador da Plataforma" por default ✔; mobile 390px sem
  overflow ✔.
- **Console → Sistema (subagente 23-b)**: tablist "Visão Geral · Faturamento ·
  Sistema" ✔; cards de 2 serviços "Operacional" (26/19 ms), Banco 800 KB/4,03 MB,
  Filas, Atividade 2/2, Runtime com heap e nota do runbook ✔; banner de alerta info
  (past_due temporário) exibido com ação e removido ao restaurar ✔; coluna Ações por
  tenant com dropdown ✔; export pelo navegador → POST 200 + download sem erros de
  console ✔; AlertDialog de encerramento com botão disabled validado em 3 estados
  (justificativa curta; confirm errado; ambos válidos) → encerrou a Serra Azul com
  toast e badge Cancelada → **revertido** (reativação + assinatura trial) ✔; mobile
  390px sem overflow ✔.

### Fases 9–12 (ciclo atual)

- **Gate de entrada**: formulário de login (e-mail/senha) ACIMA dos perfis demo; login
  real de `ana.ribeiro@…` (`DemoLegis!2026`) → cookie `legis_session` httpOnly emitido e
  ator ativo no topbar; senha errada → 401 (inline, sem toast duplo) ✔
- **Sair**: confirmação → sessão revogada + estado local limpo → gate reabre ✔
- **Módulo Usuários** (Ana, tenant_admin): tabela com 8 usuários (incluindo Tiago
  INATIVO do seed), filtro por papel, busca, botão Novo usuário ✔
- **Publicações e Audiências**: 3 abas; tabela com 5 publicações (0001–0005/2026);
  aba Moderação com badge "2" (Lúcia do seed + Pedro enviada pelo portal) ✔
- **Caminho de ouro da participação popular**: Portal → Audiências → AO VIVO com 1
  respondida → formulário do cidadão preenchido (Pedro Alves Camargo) → pergunta criada
  `pending` e **invisível no portal** → Moderação → `Aprovar` → **pergunta publicada no
  portal** em segundos; notificações geradas para admin e adm. legislativa ✔
- **Analytics**: seletor de ano, KPIs, gráfico de presença por parlamentar, rosca de
  matérias por situação, barras de coesão de 11 partidos, ranking com barras de progresso
  e Exportar CSV ✔ (sem erros de console)
- **Console → aba Faturamento** (platform_owner): KPIs (MRR R$ 599,00; em aberto;
  vencidas; pagas no ano), tabela com 5+ faturas com badge Vencida na 0002 da Serra Azul,
  Executar ciclo do mês, uso por tenant ✔
- **Portal Público**: 6 abas (Ao Vivo · Pesquisa · Sessões · **Publicações** ·
  **Audiências** · Dados Abertos); publicação revogada com selo; audiências agrupadas
  EM ANDAMENTO/AGENDADAS/ENCERRADAS ✔
- Mobile 390px: menu hamburger, footer presente e empurrado pelo conteúdo ✔
- Console do navegador: sem erros nas visitas ✔

### Ciclos anteriores (fases 1–8, revalidados)

- Gate de perfis com 7 atores (incluindo Operador da Plataforma após correção) ✔
- **Dashboard**: cartões de pendências do processo legislativo (2 vencidas/5 pendentes/3
  protocolos/18 matérias) com navegação ✔
- **Estrutura Institucional**: 5 abas; legislatura atual 18ª (2026–2029); mesa vigente
  com ações de encerrar vigência ✔
- **Protocolo e Tramitação**: livro com 9 protocolos + ações distribuir/arquivar/anular;
  tramitação com último andamento; prazos com badge "Vencida" (texto+cor) ✔
- **Dossiê da matéria** (drawer): timeline (3 andamentos), 2 versões, 2 anexos ✔
- **Portal Público**: 4 abas; pesquisa com filtros e tabela; dados abertos com downloads ✔
- **Webhooks**: card do endpoint com switch ativo, revelar/copiar segredo, entregas,
  testar, editar, excluir ✔
- **Sino de notificações**: badge com contador, popover com item navegável e "Marcar
  todas como lidas" ✔
- **Relatórios**: espelho e **Minuta de Ata** (estruturada + rascunho IA com revisão) ✔
- **App do Parlamentar**: sessão atual com presença "Ausente", botão de presença
  **desabilitado corretamente** (sessão scheduled) com motivo, fila e histórico ✔
- **Console da Plataforma**: KPIs, 3 tenants (incluindo criado pelo onboarding no
  navegador), health scores, planos ✔
- **Migração**: wizard 8 estágios — "Inspecionar" executado pelo navegador com conclusão
  verde e habilitação dos estágios seguintes; execuções anteriores com issues 13i/18a/4e ✔
- Mobile 390px (menu hamburger), dark mode, footer fixo — revalidados neste ciclo ✔
- Console do navegador: sem erros nas visitas ✔

## 3. Defeitos encontrados e corrigidos (neste ciclo)

| Defeito | Causa | Correção |
|---|---|---|
| 500 em rotas novas após `db:push` | Client Prisma antigo em memória no dev server | `db:generate` + restart do dev server (documentado no runbook §2) |
| `GET /migration/runs/:id` → 500 | orderBy por `createdAt` inexistente em `MigrationIssue` | orderBy `severity,id`; view sem o campo |
| Operador da Plataforma inacessível no navegador | Bootstrap listava apenas usuários do tenant (platform_* tem tenantId null) | Bootstrap inclui papéis `platform_*` ativos sem tenant (ADR-005) |
| Cadeia de auditoria quebrava com eventos simultâneos | Timestamps idênticos no seed empata ordenação | Timestamps distintos no seed (herdado da Fase 4, mantido) |
| Dev server caiu durante execução dos subagentes | Processo anterior não orfanado corretamente | Restart com `setsid` (padrão runbook §1); serviços orfanados sobrevivem |
| Gate de entrada nunca abria após o login real (auto-login de operador) | `Boot` selecionava automaticamente o session_operator quando não havia ator | Auto-login removido: gate é o ponto de entrada (login + perfis); "Sair" limpa também o estado persistido do zustand |
| Spam de toasts 401 com o gate aberto | Consultas de fundo sem ator disparam erro global | 401 sem ator selecionado não dispara toast (ruído esperado no gate) |
| Lint: `setState` síncrono em `useEffect` (4 módulos novos) | Padrão de reset derivado de dados nos subagentes | Reset derivado no render (padrão React) ou derivação de valor no escopo |
| Seed: ordem temporal dos eventos de auditoria das fases 9–11 | Cadeia verifica por `createdAt asc`; chamadas fora de ordem quebrariam a validação | Eventos reordenados em ordem cronológica crescente |

### Fases 13–16 (v0.10.0)

| Defeito | Causa | Correção |
|---|---|---|
| Palette escondia resultados do servidor e Enter podia ficar sem destino | `CommandDialog` (shadcn) não encaminha `shouldFilter`/`value` — o filtro fuzzy local escondia itens do servidor e a seleção ficava obsoleta com cache | Diálogo montado com Dialog+Command direto (`shouldFilter={false}`) + seleção controlada com fallback derivado no render |
| Grade da Agenda causava scroll horizontal em 390px | Grid implícita `auto` expandia ao `max-content` dos chips `nowrap` | `grid-cols-1` explícito + `min-w-0` em cards/células/chips (overflow 660→390 px) |
| Central de Ajuda citava permissão inexistente `webhook.write` | Erro de conteúdo na fonte única | `help-content.ts` corrigido para `webhook.manage` (pós-E2E) |
| Dev server caiu 1× durante a Fase 16 | Mesma queda já registrada no ciclo anterior | Restart orfanado do runbook (§1), sem rebuild |

## 4. Não executado / limitações

| Item | Motivo | Estratégia |
|---|---|---|
| Testes automatizados (unit/integração/contrato) | Diretriz do ambiente (sem testes escritos); cobertura por verificação real de fluxo | Em produção: vitest + Testcontainers + OpenAPI diff no CI (prompt mestre §16) |
| Load/k6, caos controlado | Fora do escopo do sandbox | Plano de carga descrito no prompt mestre §16.5 |
| Webhook para URL externa real | Saída de internet incerta do sandbox | Echo local valida o pipeline completo (assinatura, retry, dead-letter) |
| leitora de tela / axe automatizado | Sem ferramenta no ambiente | Auditoria manual de acessibilidade (contraste, foco, texto em badges, ARIA) feita por inspeção; WCAG 2.2 AA é requisito de produção |
| Alerta **critical** de serviço parado (Fase 16) | Serviços 3003/3004 estavam no ar durante a verificação; derrubá-los interromperia outros testes em paralelo | Lógica idêntica à do alerta past_due validada (derivação na leitura); em produção, caos controlado no CI |
| Sigilo do voto secreto no export (Fase 16) | Base demo não possui votação secreta COM votos | Votação secreta temporária criada via Prisma pelo subagente 23-b, re-export conferido (`value: null`, participação preservada) e votação removida |
| Rate limit em memória (Fase 19) | Janela deslizante por PROCESSO: reinicia com o dev server e não vale atrás de múltiplas réplicas; buckets quentes durante o E2E podem dar 429 legítimo | Produção: Redis por bucket (contrato `hitRateLimit` estável); no sandbox usar IP distinto (`x-forwarded-for`) ou aguardar a janela |
| Worker de export in-process (Fase 20) | Restart do servidor durante `running` deixa job órfão em running (a guarda 409 persiste e nenhum novo job nasce) | Interpretar/recriar conforme runbook §8; produção: fila persistente com worker dedicado |
| Alertas persistem apenas quando o system-status é lido (Fase 20) | Sem cron server-side, um incidente nunca lido não gera PlatformAlert | Produção: poller cron; no sandbox, Console/Suporte com auto-refresh 30s |
| Desvinculação de relacionamento é física (Fase 17) | DELETE remove a linha (a auditoria preserva o rastro do vínculo) | Produção: anulação auditada (append-only) — ADR-018 |
| Recibo do voto secreto prova participação (não valor) | Sem correlação individual com o resultado — por design | Documentado no ADR-019; revisão criptográfica antes de produção com dados reais |
| Ata verificável apenas no módulo Relatórios (Fase 19) | `/public/verify` cobre publicações do diário; atas usam código da cadeia de auditoria | Produção: verificação pública unificada (ADR-020) |
| Impersonação exige sessão por senha (Fase 20) | Perfis demo `x-actor-id` recebem 409 — não impersonam (por design) | Usar login real (joao.prado@legissaas.dev); produção: MFA no suporte |

## 5. Riscos remanescentes

1. **Provedor de IA** (z-ai): latência 10–30s por geração; timeout 60s tratado com 504.
2. **SQLite single-writer**: escritas concorrentes serializadas; escalabilidade vertical
   limitada (migração para PostgreSQL prevista — ADR-001).
3. **Voto secreto**: sigilo operacional (valor jamais exposto), não criptográfico —
   revisão por especialista antes de produção com dados reais.
4. ~~**Desativação de tenant** é financeira/operacional~~ — **CORRIGIDA na Fase 9**:
   `403 TENANT_INACTIVE` bloqueia papéis com escopo de tenant no login e em toda
   requisição (ADR-010).
5. **Login por cookie no sandbox**: cookie sem `Secure` (gateway HTTP) e sessões em
   SQLite (sem store distribuído) — produção exige OIDC/MFA e Redis (ADR-010).
6. ~~**Endpoint público de perguntas**: sem rate-limit/captcha no sandbox (ADR-012).~~
   — **CORRIGIDO na Fase 19**: rate limit real (5/10min/IP perguntas, 5/h assinaturas,
   30/min verify) com 429 + `Retry-After` (ADR-020); a implementação segue em memória por
   processo (ver §4).
7. **Analytics recalcula agregações a cada chamada** (sem cache/materialização — ADR-013).
8. **Recibos HMAC (Fase 18)**: quem detém o segredo da plataforma E acesso de leitura ao
   banco poderia forjar recibos nominais — aceitável no sandbox; produção exige
   custódia/rotação com vigência (ADR-019).
9. **Worker de export fire-and-forget (Fase 20)**: job órfão em `running` após restart do
   servidor (guarda 409 persiste); progresso por polling, sem websocket para jobs (ADR-021).
