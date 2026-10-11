# Etapa 007 — Saúde operacional da reconciliação de mídia

**Data:** 10/10/2026 · **Estado:** em andamento. Sinal de vida e verificação local entregues; integração a alertas externos e ensaios de falha prolongada pendentes.

## Objetivo e entrega

Detectar a parada do worker mesmo quando não há destinos para processar. O
processo contínuo grava uma batida a cada dez segundos e ao fim de cada ciclo
em `MediaWorkerHeartbeat`; a execução diagnóstica `--once` não se anuncia como
serviço permanente. `bun run media:health` consulta o banco e devolve JSON
sem identificadores de tenant, URLs ou chaves. Sai com código 0 se saudável,
2 se o heartbeat tem mais de 30 segundos, há intenção pendente há mais de
60 segundos ou existe destino em erro, e 3 se o próprio check falhar. O
resultado é apto a ser coletado por systemd e pelo monitoramento externo da
Casa. Erros de reconciliação continuam notificados dentro do produto;
parada total do worker exige esta verificação independente.

Arquivos: [modelo](../../prisma/schema.prisma),
[migração 007](../../prisma/sql/007-media-worker-heartbeat.sql),
[leitura operacional](../../src/lib/server/media-operations.ts),
[worker](../../scripts/media-reconcile.ts),
[verificador](../../scripts/media-health.ts),
[unidade](../../deploy/systemd/legis-media-health.service.example) e
[timer](../../deploy/systemd/legis-media-health.timer.example).

## Verificação

- Migração aditiva aplicada primeiro a uma cópia: integridade `ok`, nenhuma
  violação de chave estrangeira, diff Prisma vazio. Base local migrada com
  backup `db/custom.db.backup.20261010T184432Z`.
- Integração em banco temporário validou ausência de worker, heartbeat vivo,
  pendência antiga, erro de destino, heartbeat vencido e resposta sem stream
  key. Worker contínuo e verificador executados em processos separados sobre
  a cópia: saúde 0 com heartbeat e ciclo registrados. O processo foi parado
  depois da prova; após 30 segundos, o verificador saiu com código 2 e
  `worker_stale`.
- `bun run test:media:integration`, `bun run test:media:domain`,
  `bun run test:security`, `bun run typecheck`, `bun run lint` e
  `bun run build` passaram localmente. CI remoto não foi executado nesta
  cópia sem `.git`.

## Operação e próximos critérios

Instalar o worker supervisionado e o timer apenas no host definitivo, com
`DATABASE_URL` apontando para a mesma base; acompanhar a falha da unidade
`legis-media-health.service` no sistema de alertas. Não chamar o comando
`--once` para manter o heartbeat vivo. O check mede a aplicação do estado
solicitado no MediaMTX; ele não confirma o recebimento público pela rede
social, qualidade de áudio, integridade da gravação nem alcance da audiência.
Esses sinais precisam de testes com a Câmara piloto e contas institucionais.

A [etapa 008](008-concorrencia-destinos-midia.md) tratou a concorrência de
destinos no mesmo caminho entre processos. Permanecem os ensaios de reinício
automático, falhas de WAN/encoder/disco, monitoramento externo, migração
PostgreSQL e homologação em hardware real.
