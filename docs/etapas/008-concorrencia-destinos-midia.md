# Etapa 008 — Concorrência entre destinos da mesma sessão

**Data:** 10/10/2026 · **Estado:** concluída para a corrida entre workers cooperantes em SQLite; homologação de infraestrutura continua pendente.

## Problema e entrega

O MediaMTX recebe a lista completa `forward` ao alterar um destino. O lease
da etapa 006 impedia dois workers de aplicar a **mesma intenção**, mas não
impedia que dois workers lessem a mesma lista e gravassem, simultaneamente,
destinos **diferentes** da mesma sessão. O último PATCH poderia apagar o
destino do primeiro.

`MediaPathLease` cria um bloqueio por caminho MediaMTX no banco. O
reconciliador o adquire antes de ler, alterar e verificar a configuração;
outro processo aguarda até dez segundos. O lease expira em 30 segundos para
recuperação após interrupção, e o worker retorna `MEDIA_PATH_BUSY` para
retry progressivo se não puder adquiri-lo. A API continua respondendo 202
ao comando, com o erro operacional visível na intenção. A operação não mantém
transação de banco aberta durante chamadas de rede. O bloqueio não guarda
URLs/chaves e não afeta os fatos deliberativos da sessão.

Arquivos principais: [modelo](../../prisma/schema.prisma),
[migração](../../prisma/sql/008-media-path-lease.sql),
[lease](../../src/lib/server/media-path-lease.ts),
[reconciliador](../../src/lib/server/media-reconciliation.ts) e
[teste de dois processos](../../tests/media-path-lease.test.ts).

## Verificação

- Migração aditiva aplicada primeiro em cópia da base: integridade `ok`,
  nenhuma violação de chave estrangeira e diff Prisma vazio. Base local
  migrada com backup `db/custom.db.backup.20261010T184850Z`.
- Dois processos Bun separados tentaram ativar destinos distintos no mesmo
  caminho contra uma Control API de teste que atrasava as leituras por 500 ms.
  O teste confirmou uma leitura de configuração em andamento por vez,
  ambos os destinos no resultado e nenhum segredo no registro do lease.
  Também confirmou a recuperação de lease vencido e a liberação após erro.
- `bun run test:media:integration`, `bun run typecheck`, `bun run lint`,
  `bun run test:media:domain`, `bun run test:security` e `bun run build`
  passaram localmente. CI remoto não executado nesta cópia sem `.git`.

## Limites e próxima etapa

O bloqueio coordena apenas escritores que usam o reconciliador. Mudanças
manuais ou por outro software na Control API podem concorrer com ele. Um
processo suspenso por mais de 30 segundos durante a chamada externa pode
retomar após expirar seu lease; MediaMTX não oferece token de fencing no
PATCH. Para produção, testar interrupção/reinício real com réplicas e migrar
o controle para PostgreSQL com critérios de disponibilidade definidos. A
confirmação externa ainda comprova configuração do encaminhamento, não que a
rede social publicou vídeo e áudio para o público.

A próxima fatia deve medir qualidade e continuidade do sinal e da gravação,
ensaiar WAN/encoder/disco, ligar alertas ao monitoramento da Câmara e fazer
homologação com equipamento e canal institucional.
