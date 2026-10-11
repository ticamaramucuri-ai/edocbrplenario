# Etapa 023 — Cancelamento pré-abertura e coerência da sessão

**Data:** 11/10/2026 · **Estado:** implementada e verificada localmente.

## Entrega

A Mesa pode cancelar uma votação `ready` antes de abri-la, com justificativa obrigatória, versão otimista, auditoria e evento de estado. O registro permanece no histórico como `cancelled`, sem resultado. Para votações criadas após esta etapa, `Voting.agendaBefore` guarda o estado e o resumo do item de pauta no instante da criação; o cancelamento restaura exatamente esses valores. Votações legadas sem snapshot voltam a `em_discussao` sem resumo. O cancelamento falha se o item já tiver sido alterado por outro fluxo.

Uma sessão só admite uma votação pendente (`ready`, `open` ou `paused`) por vez. Suspender exige pausar a votação aberta; encerrar exige concluir ou cancelar qualquer votação pendente. Abrir, retomar e fechar uma votação requerem sessão aberta ou retomada. O serviço compartilhado de voto confere esse estado novamente dentro da transação, inclusive para dados legados incoerentes. A interface oferece o cancelamento com justificativa e mostra seu resultado no histórico.

Arquivos principais: [máquinas de estado](../../src/lib/server/domain.ts), [criação](../../src/app/api/v1/sessions/[id]/votings/route.ts), [transições de votação](../../src/app/api/v1/votings/[id]/transition/route.ts), [transições de sessão](../../src/app/api/v1/sessions/[id]/transition/route.ts), [serviço de voto](../../src/lib/server/voting-service.ts), [painel](../../src/modules/plenary/voting-tab.tsx), [migração](../../prisma/sql/023-voting-flow-guards.sql) e [testes](../../tests/voting-flow-guards.test.ts).

## Migração e verificação

A migração acrescenta apenas `Voting.agendaBefore`, opcional, sem alterar votações existentes. Foi ensaiada em cópia com `integrity_check=ok`, nenhuma chave estrangeira inválida e nenhuma diferença em relação ao schema Prisma. Antes de aplicar ao banco local foi criado `db/custom.db.backup.voting-flow-20261011`; as mesmas verificações passaram após a aplicação. Havia uma votação `ready` pré-existente no banco local, preservada sem mudança de estado.

`bun run test:voting:flow-guards` cobre cancelamento, restauração exata da pauta, duplicidade, versões, suspensão, retomada, encerramento e voto em sessão suspensa legada. Regressões de impedimentos, relatórios, política de votação, base deliberativa e preparação da sessão passaram. `bun run typecheck`, `bun run lint` e `bun run build` passaram. O novo teste integra a CI.

## Limites e etapa seguinte

Anulação de votação já encerrada continua sendo uma ação distinta: ela reverte resultado e matéria, e exige justificativa. O fluxo ainda não automatiza voto de desempate, voto de qualidade ou peso especial da Presidência; esses mecanismos dependem de configuração específica e homologação do regimento de cada Câmara. A próxima etapa deve verificar anulações em presença de votações posteriores da mesma matéria e ampliar testes integrados de sessão, ata, dados públicos e transmissão ao vivo. Nextcloud e Alfresco permanecem para o final do projeto.
