# Etapa 033 — Leitura do outbox em PostgreSQL

**Data:** 11/10/2026 · **Estado:** concluída como prova isolada; a migração operacional da etapa 030 continua em andamento.

O serviço realtime pode usar `REALTIME_DATABASE_PROVIDER=postgresql` com `DATABASE_URL` PostgreSQL e um cliente Prisma gerado para esse provedor. Nesse modo, lê eventos `pending`, publica os envelopes interno e público nas salas da Câmara e grava `published`/`publishedAt` somente após a emissão. A consulta por estado, em vez de cursor por sequência, evita omitir eventos de transações que confirmem fora da ordem de criação. O modo SQLite do piloto conserva a leitura com checkpoint e não escreve no banco.

**Evidência:** `bun run test:postgres:foundation` aplicou o esquema em PostgreSQL 16 efêmero, restaurou backup e passou o teste novo de duas Câmaras, separação dos payloads, nova tentativa após falha e ausência de reemissão após confirmação. Também passaram a jornada de sessão, a prontidão e o ensaio de capacidade existentes. `bun run typecheck` e lint dos arquivos alterados passaram.

**Limites operacionais:** execute um único publicador por banco PostgreSQL. A semântica é de pelo menos uma emissão: queda entre envio e confirmação pode repetir o `eventId`; clientes devem deduplicá-lo. `published` confirma apenas a entrega à camada Socket.IO, não a recepção por cada cliente. Antes da ativação com dados reais, definir tratamento para eventos antigos ainda `pending` e testar o serviço completo conectado por WebSocket ao banco migrado. Não use esta prova para trocar `DATABASE_URL` da implantação completa: scheduler, webhooks, migrações e demais testes ainda precisam ser portados.

**Próxima etapa:** portar scheduler e webhooks para acesso PostgreSQL com ensaios de retry/idempotência; depois preparar migração versionada, cópia de dados, reversão e ensaio da aplicação completa. Integrações com Nextcloud e Alfresco seguem para o final do desenvolvimento, conforme decisão do projeto.
