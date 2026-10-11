# ADR-021 — Suporte com impersonação auditada, alertas persistentes e exportação assíncrona

**Status:** Aceito · **Data:** 2026-08-31 (Onda 4 / Fase 20) · **Contexto:** sandbox

## Contexto

O prompt mestre exige impersonação de suporte com **permissão elevada, motivo, banner
visível, prazo e auditoria dedicada** (§5/§6, com o papel `platform_support` ativo), alertas
operacionais que **persistem** com reconhecimento (§15 — na Fase 16 eram derivados na leitura
e descartados) e jobs **assíncronos com progresso** para a exportação integral do tenant
(§7.10 — o export da Fase 16 era síncrono, montando o JSON inteiro na memória da requisição).
Até a v0.10.0 não existia usuário de suporte nem forma auditada de operar como outro usuário.

## Decisão

1. **Impersonação exige sessão autenticada por SENHA**: `POST /api/v1/platform/impersonations`
   lê o cookie `legis_session` (o modo demo `x-actor-id` não tem sessão → **409 explicando**
   que perfis de demonstração não impersonam). RBAC `impersonation.manage`
   (platform_owner, platform_support) verificado sobre o usuário REAL da sessão. Body:
   `{targetUserId, reason ≥ 10 (max 500), minutes 5–60 default 30}` (422 com field errors).
   Alvo precisa existir, estar ativo, ter tenant e papel NÃO-platform — **impersonar
   platform_owner/platform_support é escalonamento de privilégio → 422** (alvos elegíveis
   listados pelo GET). Uma impersonação ATIVA por suporte (422; prazo vencido sem leitura é
   encerrado lazy na hora e prossegue).
2. **Acoplamento à sessão + auditoria na cadeia do tenant-ALVO**: a criação grava
   `SupportImpersonation` + acopla `impersonationId` à `AuthSession` atual + auditoria
   `support.impersonation_started` (actorName "Nome (Suporte)", before/after com alvo, motivo,
   prazo) em UMA transação; `POST /:id/end` encerra + limpa TODAS as sessões acopladas +
   audita `support.impersonation_ended` (idempotente).
3. **Transparência total — o ator É o alvo**: `resolveSessionContext` devolve como usuário
   EFETIVO o ALVO enquanto a impersonação está ativa; `resolveActor` e TODAS as rotas
   enxergam o ator-alvo sem alteração (escopo, RBAC e auditoria da Casa valem para o
   suporte-operando-como-alvo). `/auth/me` devolve o ator-alvo + `actor.impersonation`
   (suporte, motivo, prazo) — o frontend exibe o **banner âmbar sticky no topbar em TODOS os
   módulos** ("(Suporte) operando como {nome} … termina em X min … Encerrar agora"),
   sincronizado a cada 60s. Rotas de impersonação resolvem RBAC sobre o usuário REAL — o
   alvo jamais autoriza.
4. **Expiração lazy e encerramentos determinísticos**: prazo vencido, alvo desativado ou
   referência órfã são detectados NA LEITURA da sessão → `endImpersonation` + a sessão volta
   a enxergar o próprio suporte; **logout encerra** a impersonação (hook em `revokeSession`).
5. **Alertas persistentes deduplicados** (`PlatformAlert`: `kind`, `severity ∈
   info|warning|critical`, `message`, `actionHint`, `meta`, `ackAt?`, `ackBy?`): o
   system-status passa a `platform.read` (platform_owner + **platform_support** — o suporte
   precisa enxergar a operação) e faz UPSERT deduplicado por `kind` ABERTO dos alertas
   derivados (transação in-process serializa o polling de 30s), respondendo `platformAlerts[]`
   (abertos primeiro, máx 20) MANTENDO `alerts` derivados. `GET /api/v1/platform/alerts`
   (`platform.read`, máx 50); `POST /:id/ack` — **exclusivo do owner** (`platform.manage`):
   grava `ackAt/ackBy` + auditoria `platform.alert_acked` (tenant do `meta` ou âncora
   multi-tenant), idempotente. Console→Sistema e o módulo Suporte exibem aberto/reconhecido
   com quem/quando.
6. **Exportação assíncrona com progresso real** (`ExportJob`: `status ∈ pending|running|
   done|failed`, `progress 0–100`, `error?`): `POST /api/v1/platform/tenants/:id/export`
   (`platform.manage`) responde **202 {job}** imediata + worker fire-and-forget in-process
   com **etapas REAIS de contagem por grupo** (8 estágios, progresso monotônico 10→92→100;
   falha → `failed` + `error` truncado — nunca preso em running). Guarda de **um job
   pending/running por tenant** (409 `CONFLICT_VERSION` em transação serializada);
   `GET` da mesma rota devolve o último job; `GET /platform/exports/:id` o status.
   `GET /platform/exports/:id/download` (409 se não `done`) **regenera o payload
   deterministicamente** via `buildTenantExport` — snapshot consistente com o estado
   corrente do tenant no momento do download (header `X-Export-Snapshot`), shape EXATO do
   export síncrono anterior (sem `passwordHash`/segredo de webhook/tokens; voto secreto
   `value: null`) + `Content-Disposition` oficial. Auditoria
   `platform.export_job_created` na criação e `platform.tenant_exported` NO DOWNLOAD
   (quando os dados realmente saem).

## Alternativas consideradas

- **Troca de `x-actor-id` (modo demo) para suporte**: sem trilha, sem prazo, sem banner —
  exatamente o que o prompt mestre proíbe (impersonação invisível).
- **Troca/emprestimo de senha do usuário-alvo**: destrutiva, revoga sessões do usuário e
  não distingue ator real de ator efetivo na auditoria.
- **Impersonação com token dedicado sem sessão**: criaria segundo mecanismo de identidade;
  acoplar à `AuthSession` existente mantém um único canal de resolução de ator.
- **Alertas apenas efêmeros + notificação**: já eram efêmeros na Fase 16; sem persistência
  não há ciclo de reconhecimento (quem viu/tratou) nem histórico entre leituras.
- **Export síncrono (Fase 16) com barra simulada**: montera o JSON inteiro na memória da
  requisição; progresso real por etapas exige job persistido.
- **Fila persistente + worker dedicado (BullMQ/Redis)**: infraestrutura ausente no sandbox;
  o worker in-process cobre o ciclo completo (criar → progredir → concluir → baixar) com a
  guarda de concorrência no banco.

## Consequências

- (+) O suporte opera com transparência comprovável: banner permanente, prazo limitado,
  motivo registrado, auditoria start/end NA CADEIA DO TENANT-ALVO — o suporte NÃO acessa
  rotas `platform.manage` (403 demonstrável) e jamais impersona papéis da plataforma.
- (+) Alertas ganham ciclo de vida (aberto → reconhecido por quem/quando) sem perder os
  derivados de tempo real; exportação mostra progresso real e o download é um snapshot
  íntegro e determinístico (sem segredos).
- (−) Worker fire-and-forget **in-process**: restart durante `running` deixa job órfão
  (a guarda 409 persiste — interpretação e recriação documentadas no runbook); progresso
  via polling (1s no Console), sem websocket para jobs; alertas só persistem quando o
  system-status é LIDO (sem cron); dedupe por `kind` aberto não cria novo registro quando
  a mensagem muda.
- (→) Produção: fila persistente com worker dedicado (jobs retomáveis), notificação ativa
  de alertas (pager/e-mail) com poller cron, alertas com TTL/agrupamento por incidente,
  download em object storage com expiração de link e impersonação com aprovação do tenant
  (opt-in contratual) e gravação de tela opcional.
