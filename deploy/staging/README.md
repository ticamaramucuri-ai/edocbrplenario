# Homologação em contêiner — topologia e limites

Esta stack existe para ensaio sintético: PostgreSQL, Redis, app, dois nós de
tempo real, webhooks, scheduler e, sob perfil, correio de laboratório.

> **Hoje ela roda na própria máquina de desenvolvimento.** Isso **não** é
> homologação fora do host. A trilha B de
> [`PLANO-CONTINUIDADE-2026-10-20.md`](../../docs/PLANO-CONTINUIDADE-2026-10-20.md)
> — prova de operação em host separado, recuperação medida e matriz de falhas
> com observador externo — segue **bloqueada por falta de host**, e nenhum
> ensaio local a substitui. Este documento é a preparação: quando houver host,
> a topologia já está desenhada e os pontos de decisão, nomeados.

## Serviços

Defina `STAGE_BUILD_VERSION` no `deploy/staging/.env` com o SHA do commit ou a
identificação imutável do build antes de subir a stack. App e workers expõem esse
valor em `/api/v1/health` ou `/health`; `local-unversioned` indica ensaio sem
identificação de versão. A sonda remota registra a versão observada, mas só
uma execução em host separado constitui a prova operacional da fase 045.

| Serviço | Porta publicada | Papel | Perfil |
|---|---|---|---|
| `postgres` | `${STAGE_DB_PORT:-55432}` → 5432 | Banco da homologação | padrão |
| `app` | `${STAGE_APP_PORT:-3100}` → 3000 | Next.js (SPA + `/api/v1`) | padrão |
| `redis` | — (só rede interna) | Streams para fanout entre nós | padrão |
| `realtime` | `${STAGE_REALTIME_PORT:-3103}` → 3003 | socket.io, nó principal | padrão |
| `realtime_peer` | `${STAGE_REALTIME_PEER_PORT:-3104}` → 3003 | segundo nó, prova de fanout | `fanout-lab` |
| `webhooks` | — | Entrega HMAC com retry | padrão |
| `scheduler` | — | Jobs e alertas periódicos | padrão |
| `mailpit` | `${STAGE_MAILPIT_PORT:-3125}` → 8025 | SMTP de laboratório | `mail-lab` |
| `mail_worker` | — | Confirmações por e-mail | `mail-lab` |

**Toda porta publicada liga em `${STAGE_BIND:-127.0.0.1}`.** O padrão é loopback:
nada responde fora da máquina. Em host dedicado, `STAGE_BIND` permite expor
**apenas a porta do app** por um proxy — banco, Redis e serviços internos
continuam em loopback por decisão, não por acidente.

## Volumes duráveis

| Volume | Conteúdo | Entra no backup? |
|---|---|---|
| `postgres_data` | Banco | sim, via `backup-bundle.py` (dump) |
| `parliamentarian_images` | Fotos e emblemas | sim, `--images-root` |
| `media_recordings` | Gravações de sessão | sim, `--recordings-root` |
| `media_replay` | Replay público | sim, `--replay-root` |
| `mailpit_data` | Caixa do laboratório | não — descartável |

Backup só do banco não restaura o sistema: os bytes de mídia e as fotos vivem
em volume separado, e um restore sem eles devolve uma Câmara sem rosto e sem
gravação. O pacote conjunto é o único artefato que vale como prova.

## Segredos

Ficam em `deploy/staging/.env`, que **não** é versionado (`.gitignore` cobre
`.env`). São três:

| Variável | Usada por |
|---|---|
| `STAGE_DB_PASSWORD` | postgres, app, workers |
| `STAGE_REALTIME_SECRET` | app e os dois nós de tempo real (precisa ser o mesmo) |
| `STAGE_ADMIN_PASSWORD` | ator sintético `stage-admin@example.invalid` |

Regras que valem desde já:

- Valor gerado **no host onde roda**, nunca reaproveitado do desenvolvimento.
- Nunca impresso em log, documento, prova JSON ou mensagem de commit.
- Rotação é parte da instalação em host novo, não uma tarefa posterior.

## Subir e parar

```bash
python3 scripts/staging-postgres.py stack-up      # banco, migrações, serviços e seed sintético
docker compose --profile fanout-lab --env-file deploy/staging/.env \
  -f deploy/staging/compose.yaml up -d --no-build realtime_peer
python3 scripts/staging-postgres.py stack-status
docker compose --profile fanout-lab --env-file deploy/staging/.env \
  -f deploy/staging/compose.yaml stop                # para sem destruir volume
```

Nunca use `down -v`: apaga os volumes duráveis, inclusive o banco.

## O que já foi provado aqui, e o que não

Provado (sintético, nesta máquina):

- [Carga concorrente de jornada, telão e portal](../../docs/etapas/045-carga-jornada-telao.md) — dois nós, 134 eventos públicos sem perda, quadro congelado estável.
- [Fanout de tempo real em dois nós](../../docs/etapas/045-fanout-realtime-dois-nos.md).
- [Telão em navegadores e duas telas](../../docs/etapas/045-ensaio-navegador-duas-telas.md).
- [Carga mista de voto, portal e replay](../../docs/etapas/045-carga-mista-voto-portal-replay.md).

**Não** provado, e que exige host separado (tarefas 7 a 10 da trilha B):

1. Segredos rotacionados no host de destino, nunca os do desenvolvimento.
2. Isolamento de rede conferido **de fora**: só a porta do app responde; banco e Redis recusam conexão externa.
3. Verificação remota de saúde, agendada por timer, com acordo de relógio.
4. Backup conjunto de banco **e** arquivos, restaurado em ambiente limpo, com RPO e RTO observados.
5. Matriz de falhas induzidas (Redis, PostgreSQL, worker de tempo real, worker de e-mail, rede, reinício do host) com o observador **fora** do host.

Enquanto esses cinco não existirem, a fase 045 continua aberta e nenhum número
medido aqui pode ser apresentado como capacidade institucional.
