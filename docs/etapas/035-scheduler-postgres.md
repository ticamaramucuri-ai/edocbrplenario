# Etapa 035 — Scheduler em PostgreSQL

**Data:** 11/10/2026 · **Estado:** prova isolada concluída; migração operacional da etapa 030 continua em andamento.

O scheduler ganhou a entrada `mini-services/scheduler/postgres.ts`, acionada por `bun run dev:postgres` no diretório do serviço, com `DATABASE_URL` PostgreSQL e cliente Prisma gerado para esse provedor. Ela mantém a porta 3005, `GET /health`, `POST /jobs/:kind/run` e tick de 30 segundos. O núcleo PostgreSQL usa Prisma para `alert.scan`, `export.watchdog`, `health.check`, `tenant.health_snapshot` e agenda de `ScheduledJob`. A rotina `notice.deadline_alerts` reutiliza a implementação Prisma da aplicação. O comando `bun run dev` continua iniciando o scheduler SQLite do piloto.

**Evidência:** `bun run test:postgres:foundation` aplica o esquema em PostgreSQL 16 descartável e verifica duas Câmaras: fatura vencida, sessão sem pauta, webhook em dead-letter, exportação órfã, serviço degradado, snapshot diário e avanço de job, incluindo repetição sem alertas duplicados. Inicia também o servidor PostgreSQL em porta temporária, consulta `/health`, rejeita kind desconhecido e executa um kind manual por HTTP. O ensaio ainda cobre realtime, webhooks, jornada de sessão, prontidão e capacidade. A rotina de avisos de prazo é testada na aplicação com o cliente PostgreSQL gerado para o ensaio.

**Limites:** execute uma única instância de scheduler por banco até implementar claim/lease para `ScheduledJob` e deduplicação transacional de alertas. O teste de `health.check` usa uma sonda simulada; o ensaio HTTP valida a entrada real, mas não mantém os demais serviços conectados durante a execução. O piloto SQLite permanece como base ativa. Antes da troca completa do banco, faltam migrações versionadas, cópia de dados, teste dos serviços conectados e reversão ensaiada.

**Próxima etapa:** testar os três serviços completos sobre PostgreSQL, depois criar e ensaiar uma migração aditiva versionada com plano de retorno. As integrações Nextcloud/Alfresco seguem para o final do desenvolvimento.
