# Migrações PostgreSQL

`migrations/0001_baseline.sql` é o DDL do `prisma/schema.prisma` convertido para PostgreSQL em 11/10/2026. Destina-se exclusivamente a **banco vazio**. `scripts/test-postgres-foundation.sh` compara o arquivo com o DDL gerado pelo Prisma e falha quando o modelo mudar sem revisão do baseline.

`migrations/0002_delivery_indexes.sql` cria índices parciais das filas com `CONCURRENTLY`; execute fora de transação. `rollback/0002_delivery_indexes.sql` remove apenas esses índices e preserva dados. O ensaio automatizado aplica, desfaz e reaplica 0002 após restaurar um backup.

`migrations/0003_parliamentarian_images.sql` adiciona a URL do emblema do partido ao parlamentar. A URL da foto já existia no esquema. Os arquivos ficam em `upload/parliamentarian-images/` e exigem volume persistente compartilhado entre instâncias HTTP; o backup PostgreSQL sozinho não inclui as imagens.

O executor `scripts/postgres-migrate.py` registra histórico e checksum e usa bloqueio consultivo. Defina `POSTGRES_MIGRATION_URL` em um gerenciador de segredos/ambiente e execute `bun run db:postgres:status` ou `bun run db:postgres:migrate`. Para remover somente os índices 0002, use `bun run db:postgres:rollback-indexes`. Falha de migração fica registrada e exige reparo explícito; não edite SQL já aplicado. Nunca aplique 0001 sobre banco com tabelas da aplicação.

A cópia de dados é feita por `POSTGRES_COPY_URL` e `bun run db:postgres:copy --source /caminho/da/replica.db`. O destino precisa estar migrado e vazio; a origem é lida via snapshot. Leia os limites na [etapa 037](../../docs/etapas/037-executor-copia-postgres.md) antes de usar em uma implantação. O SQLite do piloto não foi migrado.
