# ADR-025 — Crescimento do SaaS: self-onboarding, trial, health score e NPS

**Status:** Aceito · **Data:** 2026-10-08 (Onda 5 / Fase 24) · **Contexto:** sandbox

## Contexto

As fases comerciais anteriores fecharam o ciclo de **faturamento simulado** (Fase 10 — faturas,
dunning, uso × limites) e a **operação** (Fase 20 — alertas, suporte com impersonação), mas a
aquisição ainda era artesanal: uma câmara nova só entrava via seed/manual, sem trial formal e sem
visão anti-churn. O ROADMAP §12.4 exige para a Fase 24: **self-onboarding** (a câmara entra
sozinha), **trial de 14 dias** com bloqueio suave pós-expiração, **health score** por tenant e
**NPS in-app** consolidado — as ferramentas clássicas de crescimento SaaS, ainda sem gateway de
pagamento real (produção).

## Decisão

1. **Self-onboarding com revisão humana**: `POST /api/v1/public/onboarding` é público (sem ator),
   validado por Zod (chamberName 3–80, cidade, UF `^[A-Z]{2}$`, e-mail, slug
   `^[a-z0-9]+(?:-[a-z0-9]+)*$` 3–40) e **rate limited 3/h/IP** (bucket `public:onboarding`,
   mesmo mecanismo do ADR-020) → 429 Problem Details + `Retry-After`. O slug precisa estar livre
   entre os pedidos **e** os tenants — pedidos ativados/rejeitados continuam ocupando o slug
   (histórico preservado; 409 `SLUG_TAKEN` com origem explícita). O pedido nasce `pendente`; a
   ativação é HUMANA (`POST /platform/onboarding/:id/activate`, `platform.manage` — owner):
   em UMA transação cria o Tenant (plano profissional, `trialEndsAt = agora + 14d`), o usuário
   owner `tenant_admin` (nome derivado do e-mail antes do @) e a Subscription `trial` de 14d no
   plano profissional (**entitlements reutilizados da Fase 10** — trial = profissional por 14
   dias), marca o pedido `ativada` e grava auditoria `platform.onboarding_activated` na cadeia do
   NOVO tenant. Rejeição (`POST /:id/reject`) exige nota de 5–200 chars (é o feedback da câmara),
   persiste no pedido e audita `platform.onboarding_rejected` ancorada no primeiro tenant ativo
   (pedido rejeitado não tem tenant). Listagem em `GET /platform/onboarding`
   (`platform.read` — owner + suporte acompanham a fila).

2. **Senha temporária exibida UMA vez** (sem SMTP no sandbox): a ativação gera 12 chars
   alfanuméricos com `randomInt` criptográfico, persiste apenas o hash scrypt (`hashPassword` de
   session.ts — mesmo formato do login da Fase 9) e devolve a senha **apenas na resposta 200
   inicial** (`{ request, tenantName, temporaryPassword }`). A UI exibe o par e-mail/senha em
   mono com botão copiar + aviso âmbar e NUNCA o reexibe. Em produção o SMTP transacional envia
   convite por e-mail (a senha deixaria de ser exibida na tela).

3. **Health score determinístico com fórmula canônica**: `src/lib/server/tenant-health.ts`
   (base Task 34) é a ÚNICA fonte do score — sessões min(35, n×12) + matérias min(25, n) +
   logins min(30, ⌊n/2⌋, via auditoria `auth.login`) + webhooks ativos min(10, n×5), janela 30d
   em **epoch ms** (SQLite/Prisma guarda DateTime como integer — corte
   `(strftime('%s','now')-30*86400)*1000`); buckets saudável ≥ 70 · atenção ≥ 40 · risco < 40.
   `GET /platform/tenants/health` (platform.read) recomputa na hora para todos os tenants ativos
   + `trend` = score atual − último snapshot; `GET /platform/tenants/:id/health` faz o mesmo para
   um tenant (404 inexistente); `POST .../health` (platform.manage) é a **captura forçada** —
   insere `TenantHealthSnapshot` (score + metrics JSON + capturedAt) além da captura diária do
   agendador (Fase 21, kind `tenant.health_snapshot`). Rotas, seed e agendador importam as MESMAS
   funções/SQL → "mesmo banco → mesmo score" (critério de aceite).

4. **Métricas SaaS em `GET /platform/metrics`** (platform.read): tenants ativos; **MRR simulado**
   = Σ priceCents dos planos das assinaturas com status `active` — **trials NÃO contam** (convenção
   SaaS: entram ao converter em cobrança; past_due também fica fora); **churn 90d** = % de tenants
   desativados com `updatedAt` nos últimos 90d sobre o total; **trials** = tenants com
   `trialEndsAt` futuro OU assinatura `trial` (união sem dupla contagem); **NPS** = média simples
   das respostas da versão atual (constante `CURRENT_VERSION = '0.12.0'`, alinhada ao
   help-content) + nº de respostas.

5. **NPS in-app idempotente por (usuário, versão)**: `GET/POST /api/v1/help/nps` autenticado
   (qualquer papel). O modelo já tem `@@unique([userId, version])` — o POST faz **upsert**
   (atualiza a própria resposta, nunca duplica; `role` regravado no update). O GET devolve apenas
   a resposta do PRÓPRIO ator (`MyNpsView`, score null quando não respondeu); a consolidação sai
   **apenas agregada** (média por versão em /platform/metrics) — respostas individuais de outros
   usuários jamais saem da rota (privacidade do feedback). O widget vive no fim da Central de
   Ajuda: 11 botões 0–10 (9–10 verde, 7–8 neutro, 0–6 âmbar), comentário opcional ≤300 e estado
   respondido com "editar resposta" (idempotente).

6. **Bloqueio suave de trial expirado centralizado na resolução do ator**: `resolveActor`/
   `tryResolveActor` (src/lib/server/actor.ts) passam a carregar `trialEndsAt` junto com `active`;
   ator **não-platform** com tenant cujo trial venceu só pode **LER** — métodos de escrita
   (POST/PUT/PATCH/DELETE) recebem **403 `TRIAL_EXPIRED`** ("Trial expirado em dd/mm/aaaa. A
   leitura permanece liberada; a gravação foi bloqueada."). O bloqueio vale para TODAS as rotas
   (inclui a API externa com chave? não — as rotas externas são somente leitura por escopo), não
   atinge papéis `platform_*` (a plataforma reativa/cobra) nem o login (a rota de login não passa
   por resolveActor). `tryResolveActor` devolve null no mesmo caso (bootstrap segue 200 via GET).

## Alternativas consideradas

- **Onboarding 100% self-service (sem fila humana)**: criaria tenant+owner automaticamente num
  endpoint público — abuso de recurso caro sem verificação e sem controle de qual município entra
  (o produto é institucional); a revisão humana custa minutos e protege a operação.
- **Trial sem bloqueio (só aviso)**: ninguém converteria; o bloqueio suave (leitura liberada,
  escrita travada) preserva os dados e o hábito de uso enquanto força a conversão.
- **Bloqueio por rota (middleware em cada endpoint)**: disperso e esquecível — centralizar na
  resolução do ator garante cobertura total por construção (uma única condição).
- **NPS por e-mail (link externo)**: sem SMTP no sandbox e taxa de resposta baixa; in-app com
  idempotência por versão captura o usuário no contexto do produto.
- **Health score com modelo estatístico/ML**: sem histórico suficiente no sandbox e não
  explicável para a operação; a fórmula determinística e auditável (mesma para rotas/seed/
  agendador) atende o critério "mesmo banco → mesmo score".
- **MRR incluindo trials**: inflaria a métrica com receita nunca confirmada; a convenção SaaS
  (só assinaturas ativas) mantém o número honesto para decisões.

## Consequências

- (+) O ciclo comercial fica completo no sandbox: a câmara pede sozinha → plataforma ativa com
  trial de 14d → saúde anti-churn visível (score + tendência + capturas) → bloqueio suave na
  expiração → NPS fecha o loop de produto.
- (+) Toda mutação de onboarding é transacional e auditada (ativação na cadeia do novo tenant,
  rejeição ancorada); a senha temporária nunca é persistida em claro nem logada.
- (+) O guard de trial é único e testável: `actor.ts` carrega `trialEndsAt` e decide por método
  HTTP — nenhuma rota precisa saber do conceito.
- (−) Sem SMTP, a senha temporária depende de copiar/colar na ativação (janela única); se o
  operador perder o momento, resta redefinir pela plataforma.
- (−) O rate limit em memória é por processo (ADR-020) e o churn 90d usa `updatedAt` do tenant
  como aproximação do momento de desativação (não há campo dedicado).
- (→) **Produção**: gateway de pagamento real (trial → cobrança com cartão/boleto, dunning
  automático, upgrades/downgrades self-service), SMTP transacional com convite por e-mail (sem
  exibir senha na tela), NPS por e-mail agendado pós-marco de uso + LGPD (consentimento e
  eliminação de comentários livres na retenção), health score enriquecido com coorte de uso real.
