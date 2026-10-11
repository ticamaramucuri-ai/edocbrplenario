# ADR-017 — Observabilidade on-demand, exportação integral e encerramento seguro do tenant

**Status:** Aceito · **Data:** Fase 16 · **Contexto:** sandbox

## Contexto

O prompt mestre exige um painel operacional com alertas (§15) e a conclusão do ciclo de
vida comercial do tenant — exportação integral dos dados e encerramento seguro (§7.1). Até
a v0.9.0 o operador da plataforma checava saúde serviço a serviço via curl do runbook, e
desativar um tenant era puramente financeiro (não revogava sessões nem cancelava
assinatura). Faltava: ver tudo junto, entregar os dados e encerrar com formalidade.

## Decisão

1. **Observabilidade on-demand, sem agendador**: `GET /api/v1/platform/system-status`
   (RBAC `platform.manage`, escopo global) executa TODOS os checks na leitura — health de
   `localhost:3003/health` e `localhost:3004/health` com `AbortSignal.timeout(2000)` e
   medição de latência, tamanho do banco (`db/custom.db` + `-wal`), filas (outbox pendente
   + idade do mais antigo; webhooks pending/dead), atividade (tenants ativos/total, sessões
   hoje, último audit) e runtime (uptime, heap). No sandbox não há cron: quem quer status
   chama a rota (a aba Sistema refaz a cada 30s).
2. **Degradar, nunca 500**: cada health check tem try/catch próprio — serviço parado vira
   card "Parado" com `detail` (timeout vira "Sem resposta em 2s"); a rota responde 200 com
   o quadro real. O painel NUNCA morre porque um serviço morreu.
3. **Alertas derivados NA LEITURA, sem estado**: `alerts[]` é recalculado a cada chamada
   (serviço parado → `critical` com ação do runbook; webhook dead / backlog do outbox →
   `warn`; assinaturas `past_due` → `info` com ação do ciclo de cobrança) — todos com ação
   sugerida. Nada de entidade de alerta para persistir/reconhecer no sandbox.
4. **Exportação INTEGRAL sanitizada** (`POST /api/v1/platform/tenants/:id/export`): JSON
   único para download (`Content-Disposition: attachment`) com 24 entidades do tenant e
   seus aninhados (matérias com tramitação/versões/anexos, sessões com pauta/presenças/
   votações/votos/discursos, publicações, audiências com perguntas, modelos com versões,
   faturas, assinatura e a cadeia de auditoria completa) + `counts` de verificação. Sem
   `passwordHash`, sem `secret` de webhook, sem tokens de `AuthSession`; votos de votação
   SECRETA saem com `value: null` (participação mantida, valor jamais — coerente com o
   plenário). Auditoria `platform.tenant_exported` gravada APÓS montar o payload (o evento
   da própria exportação não entra no arquivo).
5. **Encerramento transacional** (`POST /api/v1/platform/tenants/:id/close`): zod exige
   `{justification ≥ 10, confirm: 'ENCERRAR'}` (422 com field errors; 404 inexistente; 409
   se já desativado). UMA transação: `active=false` + revogação de TODAS as `AuthSession`
   do tenant + assinatura → `canceled` + auditoria `platform.tenant_closed` com a
   justificativa. Dados NUNCA são apagados (retenção LGPD + cadeia de auditoria);
   reversível apenas por reativação auditada; usuários do tenant passam a receber 403
   `TENANT_INACTIVE` (Fase 9).

## Consequências

- (+) O quadro operacional está sempre a um GET de distância e sobrevive a serviços
  caídos; exportação serve portabilidade (LGPD) e backup de saída; encerramento é formal,
  auditado e reversível sem perda de histórico.
- (−) Sem histórico/tendência de métricas (cada leitura é um retrato); export síncrono
  monta o payload inteiro em memória; alertas só são vistos com o console aberto (sem
  notificação ativa).
- (→) Produção: poller cron gravando snapshots + alertas persistentes com notificação
  (e-mail/pager), exports assíncronos em object storage (S3) com progresso e expiração do
  link, e workflow de LGPD com DPO (prazos de retenção e eliminação certificada após
  janela legal).
