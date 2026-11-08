# Migrações PostgreSQL

`migrations/0001_baseline.sql` é o DDL do `prisma/schema.prisma` convertido para PostgreSQL em 11/10/2026. Destina-se exclusivamente a **banco vazio**. `scripts/test-postgres-foundation.sh` compara o arquivo com o DDL gerado pelo Prisma e falha quando o modelo mudar sem revisão do baseline.

`migrations/0002_delivery_indexes.sql` cria índices parciais das filas com `CONCURRENTLY`; execute fora de transação. `rollback/0002_delivery_indexes.sql` remove apenas esses índices e preserva dados. O ensaio automatizado aplica, desfaz e reaplica 0002 após restaurar um backup.

`migrations/0003_parliamentarian_images.sql` adiciona a URL do emblema do partido ao parlamentar. A URL da foto já existia no esquema. Os arquivos ficam em `upload/parliamentarian-images/` e exigem volume persistente compartilhado entre instâncias HTTP; o backup PostgreSQL sozinho não inclui as imagens.

`migrations/0007_official_configuration.sql` adiciona a revisão institucional por Câmara e marcações de sessão oficial. Sessões antigas continuam como ensaio; só novas sessões explicitamente marcadas oficiais passam pelo bloqueio de publicação.

`migrations/0008_session_preparation.sql` adiciona PDFs versionados da sessão (`BYTEA`), o manifesto documental em cada revisão de pauta e declarações manuais de entrega externa da convocação. O copiador SQLite→PostgreSQL converte e concilia bytes por representação hexadecimal.

`migrations/0009_attendance_commands.sql` adiciona a chave idempotente de presença por sessão. `migrations/0010_symbolic_tally_revisions.sql` registra revisões da contagem simbólica para conferência por duas identidades. O ensaio de fundação aplica ambas e testa os fluxos também em PostgreSQL.

`migrations/0011_ata_review_publication.sql` adiciona revisão e hash de publicação, além da chave única da ata vigente por sessão. Publicações legadas não recebem hash presumido.

`migrations/0012_media_public_observation.sql` registra a conferência humana da página pública por destino e a observação utilizada ao publicar o link oficial. Não armazena chaves RTMPS.

`migrations/0013_mail_delivery.sql` adiciona a fila de confirmação por e-mail. Cada item aponta para a assinatura e guarda apenas o hash do token vigente; o worker relê o token antes de enviar e cancela itens revogados ou substituídos.

`migrations/0014_display_state.sql` guarda por sessão o modo e perfil do telão com versão crescente. O evento `display.command` é gravado na mesma transação; após reconexão, o telão consulta a versão corrente em `public/live`.

`migrations/0015_display_frozen_frame.sql` armazena o quadro público congelado e seu hash SHA-256. A API só o entrega enquanto a mesma sessão e versão permanecem congeladas.

`migrations/0019_session_matter_snapshot.sql` adiciona manifesto de matéria e bytes de anexo por revisão. Revisões anteriores ficam com manifesto nulo e não podem gerar pacote local; publicar nova revisão após materializar os anexos é necessário. Os bytes entram no backup do PostgreSQL.

`migrations/0020_local_server_device_identity.sql` acrescenta identidade pública e designação de desktop por Câmara, nonces de pedidos e o sinal de MFA verificado na sessão administrativa. Não designa equipamento automaticamente; sessões de login antigas precisam autenticar-se novamente com TOTP para gerir dispositivos.

O executor `scripts/postgres-migrate.py` registra histórico e checksum e usa bloqueio consultivo. Defina `POSTGRES_MIGRATION_URL` em um gerenciador de segredos/ambiente e execute `bun run db:postgres:status` ou `bun run db:postgres:migrate`. Para remover somente os índices 0002, use `bun run db:postgres:rollback-indexes`. Falha de migração fica registrada e exige reparo explícito; não edite SQL já aplicado. Nunca aplique 0001 sobre banco com tabelas da aplicação.

A cópia de dados é feita por `POSTGRES_COPY_URL` e `bun run db:postgres:copy --source /caminho/da/replica.db`. O destino precisa estar migrado e vazio; a origem é lida via snapshot. Leia os limites na [etapa 037](../../docs/etapas/037-executor-copia-postgres.md) antes de usar em uma implantação. O SQLite do piloto não foi migrado.
