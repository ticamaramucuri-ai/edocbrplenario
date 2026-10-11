# Etapa 036 — Serviços integrados e migrações iniciais PostgreSQL

**Data:** 11/10/2026 · **Estado:** ensaio descartável concluído; migração operacional da etapa 030 ainda em andamento.

`bun run test:postgres:foundation` agora sobe realtime, webhooks e scheduler simultaneamente sobre o mesmo PostgreSQL 16 efêmero. O teste cria duas Câmaras, assina as salas Socket.IO pública e interna, grava eventos no outbox e comprova o isolamento de tenant e de payload. Um receptor HTTP local recebe o webhook, confere corpo, assinatura HMAC e `x-legis-delivery-id`; a entrega vira `success`. O scheduler executa `health.check` por HTTP e enxerga os dois serviços e o banco saudáveis. Portas aleatórias em loopback evitam colisão com o piloto. Ao terminar, os processos e o contêiner são encerrados e o cliente Prisma SQLite local é restaurado.

O SQL inicial PostgreSQL foi congelado em `prisma/postgres/migrations/0001_baseline.sql`. A prova compara esse arquivo com o DDL gerado do `prisma/schema.prisma` atual e falha se houver divergência. A migração `0002_delivery_indexes.sql` acrescenta dois índices parciais para filas pendentes; o ensaio confirma sua presença, aplica `rollback/0002_delivery_indexes.sql` no banco restaurado, confirma que os índices saíram sem perder o tenant e reaplica a migração. `CONCURRENTLY` exige execução fora de transação. O baseline destina-se **somente a banco PostgreSQL vazio**. O retorno de um baseline com dados exige restauração de backup, não `DROP TABLE`.

**Evidência:** ensaio integrado, testes isolados de realtime/webhooks/scheduler, avisos de prazo, jornada de sessão, prontidão, capacidade e backup/restauração passaram no mesmo comando. Os índices 0002 foram aplicados, revertidos e reaplicados no banco descartável. O SQLite do piloto não foi modificado.

**Limites:** os arquivos SQL são versionados e verificados, mas ainda não há um executor de migrações com histórico, bloqueio e retomada de falhas. Não há cópia de dados reais SQLite→PostgreSQL, ensaio de cutover, medição de RTO/RPO nem rollback da aplicação em implantação. Realtime, webhooks e scheduler ainda operam com uma instância por banco nos caminhos PostgreSQL. Não direcionar a implantação ativa para PostgreSQL nesta etapa.

**Próxima etapa:** criar o executor controlado das migrações, mapear e ensaiar a cópia de dados com preservação de IDs e cadeias de auditoria, conciliar contagens/hashes e medir cutover/retorno em ambiente descartável. Integrações Nextcloud/Alfresco permanecem para o fim do desenvolvimento.
