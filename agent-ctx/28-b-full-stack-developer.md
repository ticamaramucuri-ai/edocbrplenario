# Task 28-b — Fase 19 (Onda 4): assinaturas do cidadão, verificação pública e rate limit

Task ID: 28-b | Agent: full-stack-developer (subagente) | Status: CONCLUÍDA (sessão de re-auditoria/re-verificação)

## Ownership exclusivo (8 arquivos + 1 helper)

- `src/lib/server/rate-limit.ts` — janela deslizante em memória (Map singleton), limpeza preguiçosa, proteção >10k chaves, `rateLimitKey` (fallback 'sandbox-local') e `rateLimitedProblem` (429 Problem Details manual com header Retry-After — RATE_LIMITED não existe em ApiErrorCode).
- `src/lib/server/subscriptions.ts` — helper de domínio: normalização de rótulos (matéria "PL 44/2026 — ementa ≤60c", sessão regimental, título da audiência), `maskEmail` (LGPD), `resolveSubscriptionTarget` (valida existência + acompanhável: sessão draft/audiência cancelada → 404), `batchTargetLabels` (Map em lote) e `toCitizenSubscriptionView`.
- `src/app/api/v1/public/subscriptions/route.ts` — POST público ?tenant=, Zod, rate 5/h/IP, idempotente (pendente/confirmada), revogada reassina com novo token, 201/200/422/404/429.
- `src/app/api/v1/public/subscriptions/confirm/route.ts` — GET ?token=, idempotente (confirmed/already_confirmed), 404 token inválido, 409 revogada, e-mail mascarado.
- `src/app/api/v1/public/verify/route.ts` — GET ?code=, rate 30/min/IP, busca global com join Tenant, válida/revogada/nao_encontrada (draft NÃO verifica).
- `src/app/api/v1/subscriptions/route.ts` — GET/DELETE gestão (subscription.manage + resolveTenantScope), stats {total, confirmed, pending, byTarget}, ordenação pendentes→confirmadas→revogadas, confirmToken SÓ em pendentes ativas, revogação auditada (subscription.revoked) e idempotente.
- `src/app/api/v1/public/hearings/[id]/questions/route.ts` — EDIT: rate 5/10min/IP antes de qualquer trabalho → 429 + Retry-After.
- `src/modules/portal/index.tsx` — EDIT: aba "Acompanhar" (form e-mail+tipo+alvo com SUBSCRIPTION_TARGET_LABEL, banners success/info 201/200-pendente/200-confirmada, card dupla confirmação+LGPD) e VerifyAuthenticityBox no detalhe da publicação (selo verde/âmbar/cinza).
- `src/modules/publications/index.tsx` — EDIT: aba "Assinaturas" (só subscription.manage; stats cards, tabela com badges, Copiar link de confirmação para pendentes com tooltip sandbox×produção, Revogar com AlertDialog) + código de verificação com botão Copiar e hint "verificável no portal público".

## Decisões para os próximos agentes

- **Token de confirmação**: exposto APENAS nas pendentes ativas da rota de gestão (`confirmToken`) — sandbox não tem SMTP; em produção circula só por e-mail (documentado em rota e tooltip).
- **Rate limit é por IP do processo**: clientIp lê `x-real-ip`/`x-forwarded-for` com fallback 'sandbox-local'. Testes curl locais sem header compartilham o MESMO bucket — para simular outro cliente use `x-forwarded-for`.
- **Buckets quentes**: public:subscriptions (1h) e public:hearing-questions (10min) permanecem acesos no processo do dev server após os testes (IPs 203.0.113.77/.100/.55 e sandbox-local). E2E imediato pode ver 429 LEGÍTIMO — usar x-forwarded-for distinto ou aguardar a janela.
- **Idempotência do POST público**: por (tenant, e-mail normalizado, kind, targetId) — a unique do schema. Revogada que reassina REATIVA o registro (mesmo id) com novo token.
- **Auditoria**: só na rota autenticada (DELETE). A rota pública de assinatura NÃO audita (LGPD — e-mail do cidadão não entra na cadeia).
- Seed da Onda 4 agora é idempotente (main corrigiu: supportImpersonation antes de user; citizenSubscription/exportJob/platformAlert antes de tenant) — reseed verificado com sucesso nesta task, sem pre-clean.

## Verificação real (re-executada nesta sessão, todos os status confirmados)

1. POST subscriptions → **201** pending (e-mail normalizado lowercase, SEM token na resposta); mesmo POST → **200** idempotente (mesmo id, token não reemitido); confirmada + POST → **200** confirmed.
2. E-mail inválido → **422** VALIDATION_ERROR; targetId inexistente → **404**; targetKind inválido → **422**.
3. confirm: pendente → **200** confirmed (e-mail "im***@..."); repetido → **200** already_confirmed; token inválido → **404**; revogada → **409** CONFLICT_VERSION.
4. verify: publicada → **200** válida (título+Câmara+data); revogada → **200** revogada (revokedAt); aleatório → **200** nao_encontrada; " ls2ud63t " → normalizada → válida; sem code → **422**.
5. GET /api/v1/subscriptions (Ana tenant_admin): **200** com targetLabels + stats; sem ator → **401**; auditor → **403** FORBIDDEN_ROLE.
6. Rate limit perguntas: 5×**201** + 6º=**429** (retry-after: 600). Subscriptions: 6º POST mesmo IP → **429** (retryAfterSeconds 3504); IP distinto → **201** (limite por IP).
7. DELETE ?id= → **200** revogada + auditEvent subscription.revoked (Ana Ribeiro, IP ::1) na cadeia; repetido → **200** idempotente; sem id → **422**.
8. `bun run lint` → **0 erros/0 warnings**; `bunx tsc --noEmit` → **0 erros nos 9 arquivos do ownership** (erros pré-existentes de NextRequest×Request em rotas de outras fases não tocados); dev.log sem erros de runtime.
9. RESEED `bun prisma/seed.ts` → sucesso (idempotente); smoke: home/bootstrap/matters 200; /subscriptions volta às 4 assinaturas VN do seed (3 confirmadas + 1 pendente primeiro, com confirmToken apenas na pendente).
