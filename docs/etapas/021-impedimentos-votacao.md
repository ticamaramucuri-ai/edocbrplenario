# Etapa 021 — Impedimentos por votação

**Data:** 11/10/2026 · **Estado:** implementada e verificada localmente; ativação por Câmara sujeita à definição da regra regimental.

## Entrega

Cada Câmara escolhe `votingImpedimentPolicy`: `disabled` (padrão), `retain_base` ou `reduce_base`. O operador registra, com justificativa, o impedimento de um parlamentar da base deliberativa de uma votação ainda pronta. Pode revogá-lo antes da abertura, também com justificativa. Ambas as mudanças exigem versão atual, ficam na auditoria e geram evento interno. Parlamentares de outra Câmara ou fora da base deliberativa não podem ser incluídos.

Ao abrir, o sistema retira os impedidos da lista de votantes e do número de presentes para o quórum da votação. O mínimo numérico de quórum configurado permanece igual em ambas as políticas. `retain_base` mantém o denominador original da maioria absoluta; `reduce_base` o diminui pelo número de impedidos. A política e a lista elegível são congeladas na abertura. Alterações posteriores nas configurações da Câmara não mudam o resultado da votação aberta. Se houver impedimentos e a política for desativada antes da abertura, a abertura é bloqueada até que a política seja definida ou os registros revogados.

O painel mostra os impedimentos e permite registrar/revogar enquanto a votação está pronta. Na votação aberta, a grade omite os impedidos. A API também bloqueia votos desses parlamentares, inclusive pelo app parlamentar, porque ambos os canais usam a mesma lista congelada. O registro não expõe o motivo na transmissão pública.

Arquivos principais: [modelo](../../prisma/schema.prisma), [API de impedimentos](../../src/app/api/v1/votings/[id]/impediments/route.ts), [abertura e apuração](../../src/app/api/v1/votings/[id]/transition/route.ts), [painel](../../src/modules/plenary/voting-tab.tsx), [configurações](../../src/modules/settings/index.tsx), [migração](../../prisma/sql/021-voting-impediments.sql) e [testes](../../tests/voting-impediments.test.ts).

## Verificação e migração

`bun run test:voting:impediments` usa banco descartável e cobre política desativada, isolamento entre Câmaras, duplicidade, revogação, bloqueio de alteração após abertura, voto impedido, política congelada e os dois resultados distintos de maioria absoluta. `bun run test:deliberative:roster`, `bun run test:voting:policy`, `bun run typecheck`, ESLint dos arquivos alterados e `bun run build` passaram. O novo teste integra a CI.

A migração SQL foi ensaiada em cópia, com `integrity_check=ok`, nenhuma chave estrangeira inválida e nenhuma diferença para o schema Prisma. Antes da aplicação local, foi criado `db/custom.db.backup.voting-impediments-20261011`. Após a aplicação, os mesmos controles passaram. A política de Mucuri continua `disabled`, sem impedimentos cadastrados automaticamente.

## Limites e etapa seguinte

O sistema registra a declaração operacional e sua justificativa; não decide por conta própria quem está juridicamente impedido. A política precisa ser homologada por cada Câmara à luz do respectivo regimento. A revogação preserva o fato no banco e na auditoria; um novo registro do mesmo parlamentar atualiza a linha ativa, com histórico anterior recuperável na auditoria. Votações antigas sem lista congelada seguem o comportamento anterior.

Próxima etapa: levar impedimentos e o denominador aplicado ao relatório/ata da votação e ao exportador de dados verificáveis, com revisão de sigilo e de permissões; depois tratar papéis especiais da Presidência somente mediante política regimental explícita. Integrações com Nextcloud e Alfresco continuam reservadas para a etapa final do projeto.
