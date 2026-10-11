# Etapa 006 — Intenção durável e reconciliação de mídia

**Data:** 10/10/2026 · **Estado:** em andamento. Núcleo de reconciliação entregue; operação e falhas prolongadas pendentes.

## Entrega

O comando de destino agora grava `MediaDestinationIntent` e auditoria em uma
transação antes do efeito externo. A API responde `202` e o painel distingue
estado desejado, estado observado, pendência e erro. Um worker separado usa
lease com atualização condicional para reivindicar cada intenção, consulta a
fonte, aplica o `forward` no MediaMTX e confirma a configuração. Falhas são
registradas apenas por código, sem URL/chave, e recebem retry progressivo.
Intenções aplicadas são verificadas periodicamente para repor destinos após
reinício do MediaMTX. Encerrar o acompanhamento exige intenção desativada e
configuração externa desligada. Falha e normalização criam notificações
internas para operador audiovisual e administrador da Câmara, uma por mudança
de estado/código para cada papel, sem repetir o alerta a cada retry.

Arquivos principais: [modelo](../../prisma/schema.prisma),
[migração](../../prisma/sql/006-media-destination-intent.sql),
[reconciliador](../../src/lib/server/media-reconciliation.ts),
[worker](../../scripts/media-reconcile.ts),
[modelo de supervisão](../../deploy/systemd/legis-media-reconcile.service.example),
[API](../../src/app/api/v1/sessions/[id]/transmission/destinations/route.ts) e
[painel](../../src/modules/plenary/transmission-tab.tsx).

## Verificação

- Migração aditiva aplicada primeiro em cópia: `PRAGMA foreign_key_check`
  vazio, integridade `ok`, Prisma diff vazio. Aplicada na base local com backup
  `db/custom.db.backup.20261010T183122Z`; base local tem zero intenções.
- Integração em SQLite temporário: dois ciclos concorrentes reivindicaram
  uma intenção uma única vez; desaparecimento da configuração foi corrigido;
  indisponibilidade gerou `MEDIA_CONTROL_UNAVAILABLE`; retries do mesmo erro
  não duplicaram notificação; recuperação gerou aviso; nova intenção de
  desativação retirou o destino. Nenhuma stream key foi persistida.
- API HTTP em cópia da base e MediaMTX local: 401 anônimo, 403 outra Câmara,
  GET 200, POST 202 pendente, worker aplicou, GET confirmou, encerramento
  bloqueado com destino ativo (409) e permitido após desativação. Respostas
  inspecionadas sem URL nem chave.
- `bun run typecheck`, `bun run lint`, testes de domínio/segurança,
  integração de reconciliação, prova RTMP→RTMPS e `bun run build` passaram
  localmente. O CI remoto permanece sem execução nesta cópia sem `.git`.

## Operação e próximos critérios

Executar `bun run media:reconcile` como serviço supervisionado com as mesmas
variáveis de banco e mídia do app; `--once` executa um ciclo para diagnóstico.
O arquivo de destinos permanece privado fora do repositório. Se o worker
parar, o painel mostrará intenção pendente. O lease previne execução
simultânea, mas ainda é necessário ensaio real com réplicas/processos
separados, supervisão/restart, falhas de disco, queda de WAN e integração de
alertas com monitoramento operacional externo. O piloto SQLite continua sem garantias de alta disponibilidade;
a migração a PostgreSQL com isolamento por tenant e o CI remoto são trabalhos
de produção. A liberação oficial depende também de hardware, contas e aceite
da Câmara piloto.
