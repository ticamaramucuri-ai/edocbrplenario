# ADR-020 — Participação e confiança pública: assinaturas do cidadão, verificação de autenticidade e rate limit

**Status:** Aceito · **Data:** 2026-08-31 (Onda 4 / Fase 19) · **Contexto:** sandbox

## Contexto

O prompt mestre exige um canal de acompanhamento do cidadão (§7.11: "Canal de
acompanhamento/assinatura"), verificação pública de documentos por código (§7.10: "QR Code ou
código de verificação para documentos públicos") e rate limit nos endpoints públicos de
escrita (§11: "Rate limit por IP, usuário, tenant e endpoint"). Até a v0.10.0 o cidadão
participava apenas de forma reativa (perguntas de audiência moderadas), não podia assinar
matérias/sessões/audiências para ser avisado, e a conferência de uma publicação exigia acesso
interno; os endpoints públicos de escrita não tinham qualquer limite de requisições.

## Decisão

1. **Assinaturas do cidadão com dupla confirmação por token** (`CitizenSubscription`:
   `tenantId`, `email`, `targetKind ∈ matter|session|hearing`, `targetId`, `token` UUID
   único, `confirmedAt?`, `revokedAt?`; par único `(tenantId, email, targetKind, targetId)`).
   `POST /api/v1/public/subscriptions?tenant=slug` cria `pending` (201) **sem token na
   resposta**; `GET /api/v1/public/subscriptions/confirm?token=` confirma (idempotente —
   repetido → 200 `already_confirmed`; inválido → 404; revogada → 409). A resposta pública
   expõe apenas e-mail **mascarado** (`jo***@dominio`) e o rótulo do alvo (LGPD).
2. **Sem SMTP no sandbox — link copiável pela gestão (documentado)**: a rota de gestão
   `GET /api/v1/subscriptions` expõe `confirmToken` APENAS nas assinaturas pendentes ativas,
   para a Casa copiar o link de confirmação e demonstrar o double opt-in (tooltip explica
   sandbox vs. produção). Em produção o token circula exclusivamente por e-mail. O formulário
   público fica na aba **Acompanhar** do Portal Público com o card "Como funciona".
3. **E-mail normalizado e idempotente**: trim + lowercase na fronteira (Zod valida formato,
   máx. 254); POST repetido → 200 idempotente por `(tenant, e-mail, alvo)` — pendente não
   reemite token, confirmada devolve a view; assinatura **revogada** que reassina é reativada
   com novo token e nova confirmação pendente.
4. **Verificação pública de publicações por código** (`GET /api/v1/public/verify?code=`):
   busca GLOBAL por `verificationCode` (8 chars, globalmente raro — sem tenant na URL, join
   com Tenant devolve o nome da Casa), código normalizado (trim + uppercase). Resultado
   sempre 200: `valida` (publicada — título, Câmara, publishedAt), `revogada` (com
   revokedAt) ou `nao_encontrada` (inexistente ou rascunho). **Atas continuam verificáveis
   no módulo Relatórios pela cadeia de auditoria** (código derivado do head da cadeia —
   ADR-004): este endpoint cobre as publicações do diário eletrônico; limitação documentada
   na própria rota. UI: botão "Verificar autenticidade" no detalhe da publicação do portal
   com selo verde/âmbar/cinza.
5. **Gestão e revogação pelo tenant** (`subscription.manage`: tenant_admin,
   legislative_admin): `GET /api/v1/subscriptions` lista com `targetLabel` resolvido,
   ordenação (pendentes → confirmadas → revogadas) e `stats {total, confirmed, pending,
   byTarget}`; `DELETE /:id` revoga (grava `revokedAt` — nunca apaga, histórico LGPD) com
   auditoria `subscription.revoked` na cadeia e idempotência. A rota ANÔNIMA de assinatura
   não audita (o e-mail do cidadão não entra na cadeia pública) e não emite outbox (o
   e-mail de confirmação é o canal do evento).
6. **Rate limit em memória com janela deslizante** (`src/lib/server/rate-limit.ts`):
   `hitRateLimit(bucket, key, limit, windowMs)` — Map module-level com timestamps das
   requisições aceitas, limpeza preguiçosa e proteção acima de ~10k chaves; chave por IP
   (`clientIp` com `x-forwarded-for` e fallback estável). Limites vigentes:
   **5/hora/IP assinaturas** (`public:subscriptions`), **5/10min/IP perguntas de audiência**
   (`public:hearing-questions`, aplicado ANTES de qualquer trabalho) e **30/min/IP
   verificação** (`public:verify`). Ao exceder → **429 Problem Details**
   (`code RATE_LIMITED`, `retryAfterSeconds`) + header `Retry-After` (montado manualmente
   porque `RATE_LIMITED` não existe em `ApiErrorCode` — erros compartilhados). Produção:
   **Redis** (INCR+EXPIRE ou sorted-set) mantendo o contrato `hitRateLimit` estável.

## Alternativas consideradas

- **Confirmação imediata (sem double opt-in)**: falsa a posse do e-mail — qualquer pessoa
  cadastraria e-mail de terceiros; o double opt-in é requisito de anti-spam/LGPD.
- **SMTP simulado no sandbox**: sem saída de rede confiável; o link copiável pela gestão
  demonstra o MESMO fluxo do token com zero infraestrutura extra.
- **Rate limit no gateway (Caddy)**: limitação global por IP sem granularidade por
  bucket/endpoint e sem Problem Details no formato da API.
- **Token no corpo da resposta do POST**: quebraria o double opt-in (quem envia o formulário
  confirma sem provar posse do e-mail).
- **Notificação por webhook/outbox na assinatura**: o consentimento do cidadão não deve
  gerar evento público (LGPD); o canal do evento é o próprio e-mail de confirmação.

## Consequências

- (+) O cidadão acompanha matérias/sessões/audiências com consentimento comprovado; a Casa
  gerencia, revoga com auditoria e enxerga estatísticas por alvo.
- (+) Qualquer pessoa confere a autenticidade de uma publicação pelo código impresso —
  sem login, com selo claro e resposta determinística (válida/revogada/não encontrada).
- (+) Endpoints públicos de escrita deixam de ser ilimitados: 429 com Retry-After
  demonstrável (5 perguntas/10min; 5 assinaturas/hora; 30 verificações/min).
- (−) Rate limit é por PROCESSO (reinicia com o dev server; sem efeito atrás de múltiplas
  réplicas); `confirm` não tem bucket dedicado (token UUID — força bruta impraticável,
  rota idempotente); o token de confirmação é visível para a gestão enquanto pendente
  (compensação documentada do sandbox).
- (→) Produção: Redis por bucket com limites por tenant, e-mail transacional real (SMTP),
  notificação de novidades ao assinante confirmado, hash do código para dificultar
  enumeração e verificação pública unificada de atas (código público derivado da cadeia).
