# Etapa 034 — Entrega de webhooks em PostgreSQL

**Data:** 11/10/2026 · **Estado:** prova isolada concluída; migração operacional da etapa 030 em andamento.

O serviço de webhooks aceita `WEBHOOKS_DATABASE_PROVIDER=postgresql` e `DATABASE_URL` PostgreSQL com cliente Prisma gerado para esse provedor. No caminho novo, ele consulta entregas pendentes vencidas, respeita endpoints inativos, registra sucesso ou reagenda falha com backoff. Na quinta falha, muda a entrega para `dead` e cria Notification e OutboxEvent na mesma transação. A chave `webhook.dead:<deliveryId>` impede notificação duplicada. O caminho SQLite do piloto permanece como estava.

**Verificação:** `bun run test:postgres:foundation` passou em PostgreSQL 16 efêmero. O teste cobre duas Câmaras, sucesso HTTP simulado, retry em cinco segundos, dead-letter com notificação e evento internos ao tenant correto, endpoint inativo e recuperação do retry. Um teste separado do remetente verifica assinatura HMAC, corpo e `x-legis-delivery-id` estável entre tentativas. A jornada de sessão, a prontidão, a capacidade, o outbox realtime e a coleta de saúde também passaram no mesmo ensaio.

**Limites:** execute um trabalhador por banco até implementar claim/lease. Uma queda depois do POST e antes de gravar sucesso pode repetir a entrega; o cabeçalho `x-legis-delivery-id`, constante em todas as tentativas, permite deduplicação pelo receptor. O ensaio usa um receptor HTTP simulado; ainda falta uma entrega ponta a ponta com o serviço em execução sobre PostgreSQL. Não ativar `DATABASE_URL` PostgreSQL na implantação completa antes de portar scheduler, versionar migração, copiar dados e ensaiar reversão.

**Próxima etapa:** substituir as consultas SQLite do scheduler por Prisma, com testes das regras de alerta, watchdog, saúde e agendamento em PostgreSQL. Integrações com Nextcloud e Alfresco seguem reservadas para o fim do desenvolvimento.
