# Etapa 010 — Rascunho e publicação deliberada da sessão

**Data:** 11/10/2026 · **Estado:** concluída para criação e numeração no ambiente local; pauta versionada e homologação regimental pendentes.

## Problema e entrega

Antes, informar matérias em `POST /sessions` publicava imediatamente a pauta e agendava a sessão. A criação agora sempre salva um **rascunho** com pauta preliminar; o operador revisa os itens e confirma separadamente **Agendar e publicar pauta**. O formulário, a lista e o contrato da API refletem esse fluxo. A adição de matérias e a reordenação ficam restritas ao rascunho; alterações em pauta já publicada exigirão um fluxo versionado na etapa seguinte. A transição `schedule` existente continua a registrar auditoria e outbox.

A numeração anual agora usa `SessionNumberCounter`, atualizado na mesma transação que cria a sessão, em vez de `MAX(number)+1`. A migração [010-session-number-counter.sql](../../prisma/sql/010-session-number-counter.sql) inicializa o contador com o maior número existente em cada Câmara/ano e é idempotente. O ano é calculado no fuso da Câmara; a mesma matéria repetida na requisição é rejeitada.

Arquivos principais: [rota de criação](../../src/app/api/v1/sessions/route.ts), [contador](../../prisma/schema.prisma), [formulário](../../src/modules/sessions/new-session-dialog.tsx), [lista e confirmação](../../src/modules/sessions/index.tsx), [teste de jornada](../../tests/session-preparation.test.ts).

## Verificação

- A migração foi aplicada primeiro em cópia isolada da base: `PRAGMA integrity_check = ok`, nenhuma violação de chave estrangeira, contador inicializado para os dois pares Câmara/ano existentes e diff Prisma vazio. Reaplicação em cópia não alterou os valores.
- Base local recebeu a migração após backup `db/custom.db.backup.session-counter-20261011`; nenhuma sessão ou Câmara foi apagada.
- `bun run test:session:preparation` usa banco descartável e passou: duas criações simultâneas recebem números distintos, ficam em rascunho apesar da matéria, respeitam o ano no fuso Bahia, rejeitam matéria duplicada e só uma sessão é publicada pelo comando explícito.
- `bun run typecheck`, `bun run lint` e `bun run build` passam após as alterações. Os testes de mídia e segurança continuam como regressão da base.
- Conferência visual em cópia da base de demonstração mostrou o formulário com “Salvar rascunho” e instrução de publicar separadamente. A aba e o servidor temporários foram encerrados após o ensaio.

## Limites e próxima entrega

O contador garante unicidade com a transação e o índice único de `Session`; a prova de concorrência executada cobre um processo local. A migração para PostgreSQL e o ensaio entre réplicas são condições de produção. Ainda não há prévia de diferenças, versões imutáveis e autorização de alteração de pauta após publicação. Ações de condução como retirada e adiamento continuam auditadas, mas devem integrar a política versionada da Câmara. Uma sessão antiga da base fictícia aparece como agendada com `agendaPublished=false`; a etapa seguinte deve auditar e corrigir dados legados inconsistentes antes de impor esse invariante no banco. O cadastro de Mucuri não contém presidente nem regimento oficial, portanto não há sessão real criada.

**Próxima etapa:** modelar revisão e versões da pauta, ampliar o formulário de sessão (local, secretaria, convocação), impedir publicação sem checklist institucional e testar o fluxo de criação, revisão e publicação com usuários da Câmara. Em paralelo, seguir o pacote P1 de PostgreSQL, isolamento, backup e CI do [plano funcional](../PLANO-FUNCIONAL-EDOCBR-PLENARIO.md). As integrações Nextcloud/Alfresco permanecem na última fase.
