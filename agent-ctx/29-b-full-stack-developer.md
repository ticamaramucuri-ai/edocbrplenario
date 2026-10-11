# Task 29-b — Fase 20 (Onda 4): Operação e suporte

Subagente full-stack-developer | Sessão: retomada + re-auditoria + verificação real completa

## Ownership exclusivo (15 arquivos do briefing + 4 helpers novos)

| Arquivo | Estado | Função |
|---|---|---|
| `src/lib/server/session.ts` | editado | AuthSession carrega `impersonationId`; `resolveSessionContext` devolve ator EFETIVO (alvo) + usuário real (suporte); expiração LAZY (`activeImpersonationForSession` encerra prazo vencido/alvo inativo/órfão e devolve null); `endImpersonation` idempotente limpa TODAS as sessões; `revokeSession` (logout) encerra a impersonação — decisão documentada |
| `src/app/api/v1/auth/me/route.ts` | editado | ator + `actor.impersonation` (ImpersonationBannerView) por SESSÃO apenas; suporte sem tenant atendido; 401 sem sessão |
| `src/app/api/v1/platform/impersonations/route.ts` | NOVO | GET (platform.read): history ativas primeiro + active da sessão + targets (papéis não-platform); POST (impersonation.manage): exige sessão por senha (sem cookie → 409 CONFLICT_VERSION), reason ≥10, minutes 5–60 default 30, alvo ativo+tenant+não-platform (422 escalonamento), 1 ativa por suporte (422; vencida → encerra lazy), cria + acopla à sessão atual + audita `support.impersonation_started` (tenant do ALVO, actorName "Nome (Suporte)") em transação → 201 |
| `src/app/api/v1/platform/impersonations/[id]/end/route.ts` | NOVO | POST (impersonation.manage, resolvido sobre o usuário REAL da sessão via resolveSupportActor — o alvo não pode encerrar); endedAt=now + limpa impersonationId de todas as sessões + auditoria `support.impersonation_ended`; idempotente (200 sem re-auditar) |
| `src/app/api/v1/platform/alerts/route.ts` | NOVO | GET (platform.read): abertos primeiro, máx 50 |
| `src/app/api/v1/platform/alerts/[id]/ack/route.ts` | NOVO | POST (platform.manage = owner): ackAt/ackBy + auditoria `platform.alert_acked` (tenant do meta ou âncora); idempotente |
| `src/app/api/v1/platform/system-status/route.ts` | editado | RBAC platform.manage → **platform.read**; alertas derivados PERSISTIDOS via `persistDerivedAlerts` (upsert dedupe por kind aberto) + resposta ganha `platformAlerts` (máx 20) MANTENDO `alerts` derivado (compat) |
| `src/app/api/v1/platform/tenants/[id]/export/route.ts` | editado | POST → **202 {job}** + `void processExportJob()` (8 etapas reais de contagem com progresso monotônico 10→92 + serialização final, 200ms/etapa; falha → failed+error; nunca preso em running); guarda 1 job pending/running por tenant (409) em withTransaction; auditoria `platform.export_job_created`; GET → último job do tenant `{job: ExportJobView \| null}` |
| `src/app/api/v1/platform/exports/[id]/route.ts` | NOVO | GET (platform.manage) → ExportJobView (status/progresso p/ polling 1s) |
| `src/app/api/v1/platform/exports/[id]/download/route.ts` | NOVO | GET (platform.manage): só done (senão 409 com estado); payload regenerado DETERMINÍSTICO via buildTenantExport; Content-Disposition `export-<slug>-<jobid>.json` + header X-Export-Snapshot; auditoria `platform.tenant_exported` APÓS montar o payload |
| `src/modules/support/index.tsx` | editado (stub→completo, 780 linhas) | saúde resumida (serviços/banco/filas/uptime enxutos), alertas persistentes com ack (só owner), "Operar como usuário" (select alvo + textarea motivo + prazo 15/30/45/60 + AlertDialog forte → POST → /auth/me → setActor alvo → invalidação total + toast), histórico com badge Ativa/Encerrada; sem sessão → aviso; conteúdo exige platform.read (demais = EmptyState "Acesso restrito") |
| `src/components/app/topbar.tsx` | editado | banner âmbar STICKY acima do header em TODOS os módulos: ShieldAlert + "Suporte da Plataforma ({nome}) operando como {alvo}" + motivo + CountdownChip "termina em X min" (remonta por impersonação, ticker 30s — sem setState síncrono em efeito) + botão "Encerrar agora" (POST end → /auth/me → setActor → toast); sincronização com useMe 60s (expiração lazy/encerramento em outra aba reflete sem reload) |
| `src/modules/console/system-tab.tsx` | editado | seção "Alertas persistentes" (estado Aberto/Reconhecido + quem/quando + botão Reconhecer p/ owner) + seção derivada renomeada "Verificações em tempo real" |
| `src/modules/console/index.tsx` | editado | "Exportar dados" assíncrono: POST 202 → painel na Visão Geral com Progress 0–100 + EXPORT_JOB_STATUS_LABEL + polling 1s (GET último job) → done → botão "Baixar exportação" (fetch blob + Content-Disposition) + toasts início/fim/falha; retry quando failed; job do seed visível ao abrir; exportTarget derivado no render (sem effect — lint fix) |
| `src/lib/contracts.ts` | APENAS adição autorizada | `impersonation?: ImpersonationBannerView \| null` em ActorView (mais nada) |

Helpers novos (precedente 28-b `subscriptions.ts`): `src/lib/server/impersonation.ts` (resolveSupportActor sobre usuário REAL, toImpersonationView, PLATFORM_ROLES), `src/lib/server/tenant-export.ts` (buildTenantExport — MESMO shape do export síncrono, sem passwordHash/webhook secret/valor de voto secreto; toExportJobView), `src/lib/server/platform-alerts.ts` (toView/compare/list/persistDerivedAlerts/alertAuditTenantId), `src/hooks/use-auth-me.ts` (useMe polling 60s, null silencioso no modo demo).

## Decisões documentadas

- **Precedência de ator**: sessão httpOnly SEMPRE primeiro (resolveActor); durante impersonação ativa `resolveSessionToken` devolve o ALVO → todas as rotas enxergam o alvo sem mudança; x-actor-id demo intacto e ignorado quando há sessão. Rotas de impersonação usam `resolveSupportActor` (usuário REAL da sessão) — o alvo nunca autoriza iniciar/encerrar.
- **Expiração LAZY** na leitura da sessão (prazo vencido/encerrada/alvo inativo → encerra e devolve o suporte). **Logout encerra** a impersonação no hook revokeSession (determinístico, documentado no cabeçalho de session.ts).
- **Auditoria de alertas**: cadeia ADR-004 é por tenant → `alertAuditTenantId` usa meta.tenantId/tenantSlug quando existem, senão tenant ativo mais antigo (âncora da operação no sandbox multi-tenant).
- **Download regenerado** deterministicamente (snapshot consistente no momento do download — documentado no header X-Export-Snapshot e no cabeçalho da rota); o job de validação roda o MESMO builder.
- **Kinds estáveis** dos alertas derivados = id do alerta derivado (`outbox-backlog`, `webhook-dead`, `service-down-<svc>`, `tenants-past-due`).

## Verificação real (curl, dev server :3000, base reseedada)

1. Login João `joao.prado@legissaas.dev` → **200** platform_support sem tenant; GET me → **200** ator João, impersonation null.
2. GET impersonations (cookie) → **200**: history 1 (Ana, encerrada do seed), active null, targets 7 (Ana presente; NENHUM platform_*).
3. POST sem cookie (x-actor-id) → **409** CONFLICT_VERSION "Sessão obrigatória".
4. POST cookie: reason "curto" → **422** (field reason); minutes 120 → **422** (field minutes); alvo suporte@legissaas.dev (platform_owner) → **422** escalonamento; payload válido (Ana, 30) → **201** expiresAt ~30min.
5. GET me com cookie → **ator Ana Ribeiro (tenant_admin, tenant Vila Nova)** + banner {impersonationId, supportName "João Prado", targetName, reason, expiresAt}. Sessão age como Ana: GET /matters → 27 matérias (escopo do tenant). system-status durante impersonação → **403** (ator efetivo é tenant_admin — coerente). Segunda impersonação → **422** "já ativa".
6. system-status (João, sem impersonação) → **200** com platformAlerts (billing.invoice_overdue aberto + outbox.lag reconhecido) e alerts derivados mantidos; POST ack pelo João → **403** FORBIDDEN_ROLE; login owner → POST ack → **200** (ackAt/ackBy "Suporte Legis SaaS"); re-ack → **200** idempotente (mesmo ackAt, sem novo evento).
7. POST end → **200** (endedAt set); GET me → **volta a João Prado**, impersonation null; re-end → **200** idempotente; GET /audit?tenant=camara-vila-nova (owner) mostra `support.impersonation_started`/`_ended`, `platform.alert_acked`, `platform.export_job_created`, `platform.tenant_exported` (actorName "João Prado (Suporte)", tenant do ALVO). Expiração LAZY comprovada (imp expirada acoplada à sessão → me devolve João + imp encerrada + sessões limpas). Logout durante impersonação → imp encerrada + sessões limpas.
8. Export (owner): GET último job → **200** job done do seed; POST → **202** {job pending 0}; 2º POST imediato → **409** "Exportação em andamento (running, 10%)"; polling → **done 100** (estágios 10/20/40/55/65/75/85/92→100 no dev.log); download → **200** com Content-Disposition `export-camara-vila-nova-<jobid>.json` + X-Export-Snapshot; JSON íntegro: 25 grupos, counts {users 7, parliamentarians 13, legislativeMatters 27, sessions 3, votings 4, votes 22, publications 5, auditEvents 33}; SEM passwordHash, SEM webhook secret, votos secretos com value null; diff de queries/counts vs export síncrono antigo (git HEAD) → idêntico (mesmas findMany/counts). Download enquanto running → **409** "não concluída".
9. RBAC: João GET /platform/overview → **403**; João POST export → **403**; João GET /platform/exports/:id → **403** (todos platform.manage, apenas owner).
10. `bun run lint` → **0 erros/0 warnings** (2 erros react-hooks/set-state-in-effect corrigidos nesta sessão: topbar CountdownChip extraído + console exportTarget derivado no render); tail -n 40 dev.log → **0 erros de runtime**.

## Correções aplicadas nesta sessão

1. `topbar.tsx`: `setNow(Date.now())` síncrono em efeito → chip de contagem extraído em `<CountdownChip key={impersonationId}>` (valor inicial capturado no mount; ticker via interval — assinatura externa).
2. `console/index.tsx`: `setExportTarget` em efeito (default primeiro tenant) → estado derivado no render (`exportTargetId` override + `useMemo` fallback tenants[0]) — efeito removido.

## Limitações

- Polling de progresso em TanStack Query (1s) — sem websocket para jobs (tempo real continua reservado a sessões/notificações).
- `processExportJob` é fire-and-forget in-process: restart do dev server durante running deixaria o job em running sem worker (a guarda 409 persiste; novo POST bloqueado até reseed/correção manual — aceitável no sandbox; produção usaria fila persistente).
- Dedupe de PlatformAlert por kind ABERTO: dois alertas diferentes do mesmo kind com mensagem alterada não criam novo registro enquanto o antigo estiver aberto (por design).
- Alertas derivados são persistidos apenas quando alguém LÊ o system-status (Console/Suporte com polling 30s) — não há cron server-side.
- A senha demo do João fica no seed (padrão do projeto para demonstração).
