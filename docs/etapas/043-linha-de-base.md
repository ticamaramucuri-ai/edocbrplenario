# Etapa 043 — Linha de base e ordem de execução

**Data:** 11/10/2026 · **Estado:** concluída para o repositório local.

O inventário atual contém 26 diretórios de módulos, 178 arquivos `route.ts` em `/api/v1`, 70 modelos Prisma e 35 arquivos de testes Bun. Esses números indicam superfície implementada, não cobertura nem homologação. A jornada fictícia de sessão (preparar → publicar → convocar → presença → fala → votar → ata/portal/telão) tem provas nas etapas 010–029. O fluxo audiovisual RTMP/RTMPS, gravação, replay e múltiplos destinos tem provas locais nas etapas 025–032. A réplica PostgreSQL, leitura, escrita e recuperação HTTP foram ensaiadas nas etapas 036–041. Fotos e emblemas entraram na 042. O diagnóstico relaciona cada fluxo com os critérios institucionais pendentes.

README e introdução do ROADMAP foram corrigidos para v0.13.0/Onda 5 entregue; o conteúdo histórico do ROADMAP foi preservado e remetido ao diagnóstico atual. A CI passou a executar o teste de isolamento das imagens. O registro de dívida e as provas de fechamento ficam em [pendências priorizadas](../PENDENCIAS-PRIORIZADAS.md).

**Gate local aprovado:** `bun run lint`, `bun run typecheck`, `bun test tests/parliamentarian-images.test.ts` e build de produção em diretório isolado. O gate não substitui a CI remota nem o aceite institucional. Nenhum dado oficial de Mucuri foi criado.

**Próxima etapa:** identidade visual do partido por Câmara e ciclo de arquivos (044). PostgreSQL operacional (045) exige ambiente isolado e teste conjunto de banco e bytes.
