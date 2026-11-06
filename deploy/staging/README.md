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

Defina `STAGE_BUILD_VERSION` no `deploy/staging/.env` com o SHA Git completo de
`HEAD` **antes de construir a imagem**. Use `python3 scripts/staging-build.py`
para exportar exatamente esse commit via `git archive` e construir a imagem;
`stack-up` chama esse mesmo roteiro. Alterações locais não entram no build
versionado. `--check` valida o SHA sem construir. Para ensaios com o diretório
atual, use `STAGE_BUILD_VERSION=local-unversioned`. O Compose não define um
build próprio para evitar que um comando direto rotule arquivos locais com
um SHA de outra árvore. O Dockerfile
grava a revisão na imagem e app e workers a expõem em `/api/v1/health` ou
`/health`; alterar o `.env` depois do build não altera a versão do binário.
`local-unversioned` indica ensaio sem identificação de versão. A sonda remota
registra a versão observada, mas só
uma execução em host separado constitui a prova operacional da fase 045.

| Serviço | Porta publicada | Papel | Perfil |
|---|---|---|---|
| `postgres` | `${STAGE_DB_PORT:-55432}` → 5432 | Banco da homologação | padrão |
| `app` | `${STAGE_APP_PORT:-3100}` → 3000 | Next.js (SPA + `/api/v1`) | padrão |
| `gateway` | `${STAGE_GATEWAY_PORT:-3181}` → 80 | Entrada única de navegador: app + WebSocket | padrão |
| `redis` | — (só rede interna) | Streams para fanout entre nós | padrão |
| `realtime` | `${STAGE_REALTIME_PORT:-3103}` → 3003 | socket.io, nó principal | padrão |
| `realtime_peer` | `${STAGE_REALTIME_PEER_PORT:-3104}` → 3003 | segundo nó, prova de fanout | `fanout-lab` |
| `webhooks` | — | Entrega HMAC com retry | padrão |
| `scheduler` | — | Jobs e alertas periódicos | padrão |
| `mailpit` | `${STAGE_MAILPIT_PORT:-3125}` → 8025 | SMTP de laboratório | `mail-lab` |
| `mail_worker` | — | Confirmações por e-mail | `mail-lab` |

Banco, app, realtime, peer, Mailpit e gateway publicam somente em
`127.0.0.1`. Para acesso de outro computador, ponha um proxy TLS do host em frente a `127.0.0.1:3181`
e publique apenas 443. O gateway encaminha a query literal
`XTransformPort=3003` para `realtime:3003`; qualquer outra rota vai para
`app:3000`. O cliente é compilado para essa origem comum, sem endereço
`127.0.0.1:3103` no bundle.

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
| `STAGE_ADMIN_PASSWORD` | administrador sintético `stage-admin@example.invalid` |
| `STAGE_MONITOR_PASSWORD` | monitor sintético `stage-platform-observer@example.invalid`; distinta da senha do administrador |

Regras que valem desde já:

- Valor gerado **no host onde roda**, nunca reaproveitado do desenvolvimento.
- Nunca impresso em log, documento, prova JSON ou mensagem de commit.
- Rotação é parte da instalação em host novo, não uma tarefa posterior.

O seed também cria `stage-platform-observer@example.invalid` com papel
`platform_monitor`, sem vínculo com Câmara. Esse papel só recebe
`system.status.read`; não recebe gestão, impersonação nem escopo global de
dados das Câmaras. O resolvedor restringe a sessão do monitor ao endpoint
de saúde. O administrador do tenant não tem esse acesso.
Para a sonda, carregar `EDOCBR_PLATFORM_EMAIL` e `EDOCBR_PLATFORM_PASSWORD`
em ambiente privado, sem passar senha em argumentos.

O perfil opcional `mail-lab` só aparece no `system-status` do app quando o
transporte de teste está configurado. Para incluí-lo na verificação completa,
defina no `.env` privado `STAGE_SMTP_HOST=mailpit`,
`STAGE_SMTP_FROM=laboratorio@edocbr.invalid` e
`STAGE_PUBLIC_BASE_URL=http://127.0.0.1:3181` (a porta acompanha
`STAGE_GATEWAY_PORT`). `STAGE_SMTP_PORT` usa 1025 por padrão. Inicie
`mail_worker` e `mailpit` com `--profile mail-lab` e recrie o app após alterar
essas variáveis. Sem transporte configurado, retire `mail` de
`--expect-services`; o relatório deve registrar essa limitação.

## Subir e parar

```bash
python3 scripts/staging-postgres.py stack-up      # banco, migrações, serviços e seed sintético
docker compose --profile fanout-lab --env-file deploy/staging/.env \
  -f deploy/staging/compose.yaml up -d --no-build realtime_peer
python3 scripts/staging-postgres.py stack-status
curl -fsS http://127.0.0.1:3181/api/v1/health?ready=1
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
- [Deliberação PostgreSQL em duas instâncias HTTP](../../docs/etapas/049-deliberacao-postgres-duas-instancias.md) — chave simultânea, apuração e fechamento concorrente.

**Não** provado, e que exige host separado (tarefas 7 a 10 da trilha B):

1. Segredos rotacionados no host de destino, nunca os do desenvolvimento.
2. Isolamento de rede conferido **de fora**: só a porta do app responde; banco e Redis recusam conexão externa.
3. Verificação remota de saúde, agendada por timer, com acordo de relógio.
4. Backup conjunto de banco **e** arquivos, restaurado em ambiente limpo, com RPO e RTO observados.
5. Matriz de falhas induzidas (Redis, PostgreSQL, worker de tempo real, worker de e-mail, rede, reinício do host) com o observador **fora** do host.

Enquanto esses cinco não existirem, a fase 045 continua aberta e nenhum número
medido aqui pode ser apresentado como capacidade institucional.
