# Etapa 020 — Base deliberativa por Câmara

**Data:** 11/10/2026 · **Estado:** concluída localmente para política opcional; ativação institucional sujeita à homologação.

## Objetivo e entrega

Cada Câmara configura `deliberativeRosterPolicy` como `active` (padrão anterior) ou `mandate_and_leave`. No segundo modo, presença e quórum consideram parlamentares ativos com mandato na data civil da sessão no fuso da Câmara; titular licenciado/afastado sai da base, e o suplente ativo indicado no afastamento entra. O cálculo é compartilhado com a convocação, mas as duas políticas são independentes. Parlamentares fora da base não podem registrar presença por operador ou auto check-in.

Ao abrir uma votação, o sistema grava os IDs dos elegíveis e a quantidade de membros. Abertura, lançamento de voto e fechamento usam essa lista congelada, mesmo que mandato, licença ou configuração sejam alterados durante a votação. O painel da sessão usa a lista da votação ativa para apresentar a mesma base ao operador. O app parlamentar não oferece a votação aberta a quem está fora da lista. Votações legadas sem snapshot continuam com o comportamento anterior.

Arquivos principais: [cálculo institucional](../../src/lib/server/institutional-roster.ts), [presença e quórum](../../src/lib/server/domain.ts), [abertura/fechamento](../../src/app/api/v1/votings/[id]/transition/route.ts), [voto](../../src/lib/server/voting-service.ts), [configuração](../../src/modules/settings/index.tsx), [migração](../../prisma/sql/020-deliberative-roster.sql) e [teste](../../tests/deliberative-roster.test.ts).

## Migração e verificação

A migração acrescenta `Voting.eligibleVoterIdsAtOpen`, opcional para votações existentes. Foi ensaiada em cópia com integridade SQLite OK, nenhuma chave estrangeira inválida e nenhuma diferença em relação ao schema Prisma. A base local recebeu a migração após backup `db/custom.db.backup.deliberative-roster-20261011`, com as mesmas verificações. Nenhuma política institucional foi ativada para Mucuri.

`bun run test:deliberative:roster` cobre licença, suplência, exclusão de quem não tem mandato, bloqueio de presença e voto, snapshot após mudança de configuração, quórum exibido e apuração. Os testes de convocação confirmam que o cálculo compartilhado preserva seu comportamento. `bun run test:session:preparation`, `bun run test:voting:policy`, `bun run typecheck`, `bun run lint` e `bun run build` passaram. O novo teste integra a CI.

## Limites e próxima etapa

Não há impedimento por matéria, suspeição, conflito de interesse, voto de desempate ou peso especial da Presidência. Uma mudança de mandato/licença durante uma votação não altera a lista congelada; se for preciso refletir nova situação, a Mesa deve seguir o procedimento regimental de suspensão/anulação e abrir outra votação. O modelo ainda não confere automaticamente a validade documental do afastamento ou da posse do suplente. Mucuri continua no padrão `active` até conferir regimento e cadastros. A próxima etapa deve modelar impedimentos por votação e seu efeito no quórum e na apuração, com justificativa e auditoria. Nextcloud e Alfresco permanecem para o final do projeto.
