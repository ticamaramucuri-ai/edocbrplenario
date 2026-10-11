# ADR-011 — Faturamento simulado do SaaS (faturas, ciclo de cobrança e dunning)

**Status:** Aceito · **Data:** Fase 10 · **Contexto:** sandbox

## Contexto

A Fase 8 entregou planos e assinaturas, mas sem faturamento: não havia cobrança, vencimento
ou consequência financeira para inadimplência. O sandbox não tem gateway de pagamento real.

## Decisão

1. **Modelo `Invoice`** por tenant/período (`@@unique([tenantId, periodYear, periodMonth])`
   — idempotência estrutural do ciclo). Numeração sequencial por tenant exibida como
   `0001/AAAA`. Status persistido: `open | paid | canceled`. **"Vencida" NÃO é status** — é
   computado na leitura (`isOverdue = open && dueAt < now`), o que mantém faturas pagas
   imutáveis e o histórico fiel.
2. **Linhas derivadas do plano e do uso real:** mensalidade do plano + excedente de
   parlamentares ativos (R$ 25/un acima do limite) + excedente de sessões no mês
   (R$ 40/un acima do limite). Limites vêm de `Plan.limits` (JSON) com fallback "ilimitado".
3. **Ciclo de cobrança** (`POST /platform/billing/cycle`, platform_owner): gera a fatura do
   mês corrente para cada tenant ativo com assinatura trial/active/past_due (skip idempotente)
   e executa o **dunning**: fatura aberta vencida mantém o status, mas assinatura
   trial/active → `past_due` + notificação ao admin do tenant + evento webhook
   `billing.invoice_overdue`.
4. **Pagamento** registra método (`pix|boleto|cartao|transferencia`) e reativa assinatura
   `past_due → active`. **Cancelamento** exige justificativa (≥ 10 caracteres) auditada.
   Pagar/cancelar só de `open` (409 `INVOICE_INVALID_TRANSITION`).
5. Toda mutação: auditoria na cadeia do tenant ALVO (ator = platform_owner) + outbox
   transacional (`billing.invoice_created|paid|overdue`) — entregues aos webhooks inscritos.
6. **Uso por tenant** (`GET /platform/tenants/:id/usage`): sessões, parlamentares ativos,
   artefatos de IA e entregas de webhook do período vs. limites do plano — o console exibe
   consumo e excedentes.

## Consequências

- (+) Ciclo comercial completo e demonstrável (MRR, inadimplência, reativação por pagamento)
  sem gateway externo; faturamento auditável e rastreável por webhook.
- (−) Sem boleto/pix reais, sem retentativa de cobrança automática (dunning é operacional,
  acionado pelo operador da plataforma). MRR soma apenas assinaturas ativas/past_due
  (trial não conta — decisão conservadora documentada no código).
- (→) Produção: substituir `payInvoice` por webhook do provedor (Pix/boleto) mantendo a
  máquina de estados; cron diário para o ciclo.
