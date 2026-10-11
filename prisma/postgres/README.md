# Migrações PostgreSQL

`migrations/0001_baseline.sql` é o DDL do `prisma/schema.prisma` convertido para PostgreSQL em 11/10/2026. Destina-se exclusivamente a **banco vazio**. `scripts/test-postgres-foundation.sh` compara o arquivo com o DDL gerado pelo Prisma e falha quando o modelo mudar sem revisão do baseline.

`migrations/0002_delivery_indexes.sql` cria índices parciais das filas com `CONCURRENTLY`; execute fora de transação. `rollback/0002_delivery_indexes.sql` remove apenas esses índices e preserva dados. O ensaio automatizado aplica, desfaz e reaplica 0002 após restaurar um backup.

Esses arquivos ainda não constituem um migrador de implantação: falta histórico aplicado por banco, exclusão mútua, retomada de falhas e cópia/conciliação de dados SQLite. Não aplique o baseline sobre uma instância que contenha tabelas do sistema. O plano de ativação e limites estão em `docs/etapas/036-ensaio-integrado-postgres.md`.
