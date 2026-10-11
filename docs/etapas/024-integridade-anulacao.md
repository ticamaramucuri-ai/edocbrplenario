# Etapa 024 — Integridade da anulação e transparência da correção

**Data:** 11/10/2026 · **Estado:** implementada e verificada localmente.

## Entrega

A anulação de uma votação encerrada só pode alterar matéria e pauta quando ela ainda é a última votação válida ou pendente daquela matéria (ou item sem matéria). O sistema também confere se o estado atual da matéria e do item corresponde ao resultado que será revertido. Se houver deliberação posterior, sanção, outra tramitação ou alteração da pauta, responde 409 e exige revisão humana. Nenhum dado é alterado nesse caso. A auditoria da anulação preserva o resultado e a contagem agregada anteriores, sem registrar voto secreto individual.

Uma anulação válida aparece como registro de correção na minuta de ata, no detalhe público da sessão e da matéria, no portal/telão ao vivo e nos datasets públicos de sessões e votações. O estado é `annulled` e o resultado é `anulado`; a contagem e o detalhe nominal deixam de ser apresentados como resultado vigente. O CSV identifica explicitamente `VOTAÇÃO ANULADA`, com colunas de votos vazias. O acompanhamento de transmissão da sessão não é interrompido pela correção da votação.

Arquivos principais: [transição e auditoria](../../src/app/api/v1/votings/[id]/transition/route.ts), [minuta](../../src/app/api/v1/reports/session/[id]/ata/route.ts), [dados abertos](../../src/app/api/v1/public/open-data/route.ts), [portal ao vivo](../../src/app/api/v1/public/live/route.ts), [serialização pública](../../src/lib/server/public-serializers.ts) e [teste integrado](../../tests/voting-annulment-integrity.test.ts).

## Verificação

`bun run test:voting:annulment-integrity` usa banco descartável e cobre votação posterior, matéria sancionada, anulação válida, reversão de pauta/matéria, auditoria da contagem, ata, APIs públicas, CSV, telão e preservação do registro de transmissão. O teste integra a CI. Regressões de fluxo de votação, impedimentos, relatórios, política e mídia; `bun run typecheck`, `bun run lint` e `bun run build` passaram. Não houve alteração de schema nem migração.

## Limites e próxima etapa

Uma anulação bloqueada requer análise humana da sequência de atos; o sistema não refaz automaticamente tramitações ou resultados posteriores. A minuta estruturada é interna; uma ata já publicada mantém seu processo próprio de retificação. O teste verifica a permanência do estado de transmissão e os contratos públicos, sem simular uma transmissão efetiva para YouTube ou outras redes, que depende de fonte e credenciais reais.

Próxima etapa: ampliar a validação integrada da transmissão social (fonte, destinos, falha/reconexão, gravação e publicação do link) em ambiente de homologação, mantendo as regras regimentais especiais da Presidência desativadas até definição de cada Câmara. Integrações com Nextcloud e Alfresco continuam para a fase final do projeto.
