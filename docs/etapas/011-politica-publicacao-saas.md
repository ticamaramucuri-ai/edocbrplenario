# Etapa 011 — Política de publicação por Câmara e revisão inicial da pauta

**Data:** 11/10/2026 · **Estado:** concluída para política inicial e snapshot de publicação; emendas posteriores entregues na [etapa 012](012-emendas-pauta-publicada.md).

## Entrega

O SaaS agora permite que **cada Câmara** configure, em Configurações, quais tipos de sessão usa, se exige secretário(a) para publicar e quantas matérias devem constar na ordem do dia. Os padrões preservam as operações existentes: quatro tipos, secretário opcional e mínimo zero. A API valida o escopo e os valores, e o servidor aplica a configuração ao criar rascunhos e ao publicar. Nenhuma regra foi fixada para Mucuri ou copiada de outra Câmara.

A regra geral para as próximas funções está formalizada na [ADR-026](../adr/ADR-026-configuracao-por-camara.md): política por tenant, validação no servidor, snapshot no ato e teste de isolamento.

Ao publicar, a transação salva `SessionAgendaRevision` nº 1 com a pauta ordenada e a política vigente. O novo `GET /sessions/:id/agenda-revisions` permite inspecionar esse registro apenas dentro da Câmara autorizada. Se as configurações mudarem depois, o registro original permanece. Pautas antigas não recebem versão inventada; sua revisão histórica não pode ser reconstruída com segurança só pelo estado atual.

O rascunho pode ser corrigido antes da publicação: tipo, data, presidente, secretário(a), local e observações. A interface usa `PATCH /sessions/:id` com versão otimista; a API confirma o escopo da Câmara, presidente ativo, tipo habilitado e ano da numeração, e grava auditoria com valores anteriores e posteriores. Assim, uma exigência de secretário não deixa uma minuta sem saída.

Arquivos principais: [configurações](../../src/modules/settings/index.tsx), [leitura da política](../../src/lib/server/domain.ts), [criação](../../src/app/api/v1/sessions/route.ts), [publicação](../../src/app/api/v1/sessions/[id]/transition/route.ts), [migração](../../prisma/sql/011-session-agenda-revision.sql) e [teste multi-Câmara](../../tests/session-policy.test.ts).

## Verificação

- Migração aplicada primeiro em cópia: integridade SQLite `ok`, nenhuma violação de FK e `prisma migrate diff` sem diferença. Base local preservada em `db/custom.db.backup.agenda-revision-20261011` antes da aplicação.
- `bun run test:session:preparation` passou em banco descartável: uma Câmara bloqueia tipo especial, secretário ausente e pauta abaixo do mínimo, enquanto outra permite tipo especial sem essas exigências. O teste também corrige o secretário no rascunho, publica em seguida, bloqueia versão antiga e edição por outra Câmara. A revisão é legível apenas pela Câmara dona e mantém a política original após alteração posterior do tenant.
- `bun run typecheck`, `bun run lint`, `bun run build` e regressão de segurança/mídia passam após esta etapa.
- Conferência visual em cópia da base fictícia mostrou o novo cartão “Preparação de sessões” com os quatro tipos, exigência de secretário e mínimo de matérias; o servidor e a aba temporários foram encerrados após o ensaio.

## Limites e próxima etapa

A revisão nº 1 registra a **publicação inicial**; inclusão, reordenação e retirada posteriores, antes do credenciamento, receberam revisões na etapa 012. A aplicação não oferece edição/exclusão da revisão, mas custódia externa e proteção contra administrador do banco ainda não existem. As políticas de quórum/maioria e tipos de matéria continuam genéricas e dependem de modelagem regimental versionada por Câmara. A prova de concorrência atual ainda usa SQLite local; PostgreSQL e ensaio entre réplicas permanecem pendentes.

**Continuidade:** emendas versionadas à pauta e correção do seed demonstrativo foram entregues na etapa 012. Convocação formal segue pendente. O piloto Mucuri continua sem parlamentares e sessões oficiais; integrações Nextcloud/Alfresco ficam no final do projeto.
