# Etapa 030 — Base operacional PostgreSQL

**Data:** 11/10/2026 · **Estado:** em andamento. Prova isolada de esquema e restauração concluída; migração da aplicação pendente.

`bun run test:postgres:foundation` cria uma instância efêmera de PostgreSQL 16 sem porta publicada, deriva o esquema PostgreSQL do Prisma atual, valida o modelo, aplica o DDL, insere um tenant fictício, gera `pg_dump`, restaura em outro banco e confirma 70 tabelas e o tenant restaurado. O contêiner e os artefatos temporários são removidos ao sair. Isso prova que o modelo de dados pode ser criado e restaurado; não migra dados reais nem altera o banco SQLite do piloto.

**Bloqueios para ativação:** o cliente Prisma principal ainda é gerado para SQLite; `mini-services/realtime`, `scheduler` e `webhooks` usam `bun:sqlite`; `src/lib/server/tenant-health.ts` contém SQL e datas específicos de SQLite. Os scripts de migração e os testes integrados também pressupõem SQLite. Portanto, ainda não se pode apontar `DATABASE_URL` da aplicação para PostgreSQL. A migração exigirá adaptar esses consumidores, gerar migrações versionadas, testar a aplicação inteira com Postgres, ensaiar cópia de dados com preservação de IDs/hashes e definir reversão, RTO/RPO e hospedagem com a operação.

**Próxima entrega:** refatorar acesso a eventos/contadores dos mini-serviços, separar SQL por provedor, executar a jornada 029 em PostgreSQL e ensaiar reversão de uma migração aditiva. Até lá, SQLite permanece como banco do piloto. Segredos ficam em variáveis de ambiente/arquivos privados; o ensaio usa apenas credencial descartável em contêiner sem rede.
