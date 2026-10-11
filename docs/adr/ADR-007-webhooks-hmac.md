# ADR-007 — Webhooks assinados com HMAC, retentativa exponencial e dead-letter

**Status:** Aceito · **Data:** Fase 6 · **Contexto:** prompt mestre §7.12 (integrações)

## Decisão

Integrações externas recebem eventos públicos do sistema via webhooks com entrega
**at-least-once**: as rotas de negócio gravam `WebhookDelivery` (pending) na mesma transação
quando o evento casa com um `WebhookEndpoint` ativo inscrito no `eventType` (helper
`enqueueMatchingWebhooks`). Um mini-serviço dedicado (`mini-services/webhooks`, porta 3004,
poller de 1s) entrega via HTTP POST com assinatura **HMAC-SHA256** do body usando o segredo
do endpoint — headers `x-legis-signature: sha256=<hex>`, `x-legis-timestamp: <epoch>` e
`x-legis-event`. Resposta 2xx = sucesso; falha → tentativa +1 com backoff fixo
(5s, 30s, 120s, 600s); após 5 tentativas → `dead` (dead-letter) + notificação ao
`tenant_admin`. Reenvio manual (`replay`) é auditado.

## Justificativa

O prompt mestre exige assinatura HMAC com timestamp (anti-replay), retentativa exponencial,
dead-letter queue e reenvio manual auditado. O padrão outbox-para-webhook garante que a
entrega nunca perde o evento de negócio (mesma transação) e não bloqueia a requisição do
usuário. O serviço separado isola falhas de rede do processo do Next.js e replica o padrão
operacional já estabelecido do `mini-services/realtime` (ADR-003).

## Alternativas consideradas

1. **Entrega síncrona na rota de negócio** — rejeitada: latência e fragilidade (endpoint
   lento travaria votação).
2. **Fila no próprio SQLite processada pelo Next.js** — rejeitada: processos serverless não
   garantem poller vivo; mini-serviço Bun dedicado é explícito e observável (health check).

## Consequências

- Entrega at-least-once exige receptor idempotente (documentado no contrato com exemplo de
  verificação da assinatura).
- O serviço escreve no banco principal (UPDATE de WebhookDelivery) — usa
  `busy_timeout` + retry em SQLITE_BUSY, coerente com a serialização do ADR-003.
- Endpoint de eco local (`POST /api/v1/webhooks/echo`) permite demonstração ponta a ponta
  sem depender de internet; alvos externos reais dependem da saída de rede do ambiente.
- Eventos privados (auditoria, notificações internas) nunca são entregues: a allowlist é a
  lista de eventos públicos do outbox + `test.ping`.
