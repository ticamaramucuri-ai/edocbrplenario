# Etapa 019 — Política de quórum e maioria por tipo de matéria

**Data:** 11/10/2026 · **Estado:** concluída localmente para votação vinculada a matéria, sujeita à homologação regimental.

## Objetivo e entrega

Cada Câmara pode configurar, por tipo de matéria, a regra de aprovação (`maioria_simples`, `maioria_absoluta` ou `unanimidade`) e o quórum mínimo de abertura. Sem regra específica, a Mesa escolhe a regra e usa o quórum geral da Câmara. Com regra configurada, a API rejeita uma regra divergente e a interface a mostra bloqueada, com o quórum aplicável. Votações sem matéria vinculada mantêm a seleção manual.

A votação grava a regra e o quórum exigido na criação. Na abertura, verifica esse quórum e registra o total de membros ativos como base da maioria absoluta. No fechamento, usa o quórum e a base registrados mesmo se a configuração da Câmara mudar. Para opções customizadas, maioria absoluta agora requer mais da metade da mesma base total usada pela votação padrão; antes ela usava apenas os presentes. Empates e abstenções mantêm os resultados determinísticos existentes.

Arquivos principais: [política](../../src/lib/server/domain.ts), [criação](../../src/app/api/v1/sessions/[id]/votings/route.ts), [abertura e fechamento](../../src/app/api/v1/votings/[id]/transition/route.ts), [motor de apuração](../../src/lib/server/voting-service.ts), [configuração](../../src/modules/settings/index.tsx), [migração](../../prisma/sql/019-voting-policy-snapshot.sql) e [teste](../../tests/voting-policy.test.ts).

## Migração e verificação

A migração acrescenta `Voting.requiredQuorum` e `Voting.memberBaseAtOpen`, opcionais para preservar votações existentes. Votações antigas usam o quórum já registrado na abertura ou a configuração geral quando esse dado não existir. Foi ensaiada em cópia com integridade SQLite OK, nenhuma chave estrangeira inválida e nenhuma diferença em relação ao schema Prisma. A base local recebeu a migração após backup `db/custom.db.backup.voting-policy-20261011`, com as mesmas verificações. Nenhuma regra específica foi ativada para Mucuri.

`bun run test:voting:policy` cobre regra configurada, bloqueio de abertura sem quórum, rejeição de contagem simbólica acima dos presentes, estabilidade após mudança de política, maioria absoluta, empate e abstenção. `bun run test:session:preparation`, `bun run typecheck`, `bun run lint` e `bun run build` passaram. Ambos os conjuntos de testes agora fazem parte da CI.

## Limites e próxima etapa

O total usado era o de parlamentares ativos na abertura. A [etapa 020](020-base-deliberativa.md) acrescentou política opcional de mandato, licença e suplência com lista congelada na abertura. O sistema ainda não modela impedimento de voto por matéria nem hipóteses de voto de desempate/peso do presidente. Esses pontos requerem regra regimental e modelo próprio antes de um piloto oficial. Integrações Nextcloud e Alfresco permanecem para o final do projeto.
