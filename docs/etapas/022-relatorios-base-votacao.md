# Etapa 022 — Base de votação nos relatórios e dados verificáveis

**Data:** 11/10/2026 · **Estado:** implementada e verificada localmente.

## Entrega

O espelho da sessão e a minuta estruturada de ata mostram, por votação, o quórum exigido, os presentes na abertura e no encerramento, a base congelada para maioria absoluta, a política de impedimentos aplicada e os parlamentares impedidos. Motivos aparecem apenas para `session_operator`, `presiding_officer`, `tenant_admin`, `legislative_admin`, `auditor` e `platform_owner`; os demais perfis com acesso ao relatório veem os nomes sem o motivo. A permissão é avaliada no servidor, e o JSON exportado do espelho recebe exatamente os dados autorizados ao usuário.

O detalhe público da sessão e o dataset público `votes` (JSON e CSV) mostram apenas os números, a política congelada e a quantidade de impedimentos ativos. Não publicam nomes nem justificativas dos impedidos. O detalhe nominal de votação secreta permanece ausente. A exportação integral do tenant passa a incluir todos os registros de impedimento, inclusive revogados, com contagem própria, para preservar a trilha operacional; remove tanto os valores individuais quanto qualquer `resultDetail` de votação secreta, inclusive em registros legados.

Arquivos principais: [resumo compartilhado](../../src/lib/server/voting-report.ts), [espelho](../../src/app/api/v1/reports/session/[id]/route.ts), [minuta](../../src/app/api/v1/reports/session/[id]/ata/route.ts), [dados abertos](../../src/app/api/v1/public/open-data/route.ts), [exportação integral](../../src/lib/server/tenant-export.ts), [interface dos relatórios](../../src/modules/reports/index.tsx) e [teste](../../tests/voting-report-basis.test.ts).

## Verificação

`bun run test:voting:report-basis` usa banco descartável e confere motivo autorizado/redigido no espelho e na minuta, resumo público, CSV sem justificativa, voto secreto sem detalhe nominal e exportação integral com valor secreto suprimido. O teste integra a CI. `bun run test:voting:impediments`, `bun run test:deliberative:roster`, `bun run test:voting:policy`, `bun run typecheck`, `bun run lint` e `bun run build` também passaram. Não há mudança de schema nem nova migração nesta etapa.

## Limites e próxima etapa

O motivo é um registro administrativo e não uma decisão jurídica automática. A minuta estruturada é um documento interno; a ata publicada mantém seu fluxo próprio de revisão e publicação. O relatório exibe os impedimentos ativos no momento da abertura, pois após esse ponto não há edição permitida. O histórico de revogações permanece na auditoria e na exportação integral.

Próxima etapa: revisão do fluxo completo de condução da votação, com estados excepcionais e regras especiais da Presidência configuráveis por Câmara somente após homologação regimental, seguida de testes de ponta a ponta com sessão, ata e transmissão ao vivo. Integrações com Nextcloud e Alfresco continuam reservadas para o final do projeto.
