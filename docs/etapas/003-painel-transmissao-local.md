# Etapa 003 — Painel de transmissão: fonte local

**Data:** 10/10/2026 · **Estado:** em andamento. Primeira fatia funcional; restream social e operação do encoder permanecem pendentes.

## Objetivo e entrega

Dar à mesa uma visão verificável do sinal local antes de criar comandos de publicação em plataformas externas. A aba **Transmissão** na Mesa do Plenário mostra status, caminho da fonte MediaMTX, bytes recebidos e perda de sinal, consultando a API a cada três segundos. Os comandos são **preparar**, **confirmar sinal e acompanhar** e **encerrar acompanhamento**. O texto da interface deixa explícito que o OBS e as redes sociais são operados separadamente nesta fase.

A API `GET/POST /api/v1/sessions/:id/transmission` confere sessão e tenant, limita acesso a `session_operator`/`tenant_admin`, valida a sequência de estados, exige sinal local para acompanhar, usa versão otimista e chave de idempotência. Cada alteração grava comando, auditoria encadeada e outbox interno na mesma transação. Repetir o mesmo comando não repete efeito; reutilizar chave para outra ação falha. Se a fonte some, o GET mostra `signal_lost` sem fingir que a transmissão foi encerrada ou afetar a sessão deliberativa.

O [modelo Prisma](../../prisma/schema.prisma) ganhou `Transmission` e `TransmissionCommand`, sem chaves de stream. A [migração SQLite aditiva](../../prisma/sql/003-transmission.sql) foi aplicada por [script com backup](../../scripts/apply-sqlite-migration.sh). A base piloto ainda não possui baseline Prisma Migrate; por isso não foi usado `db:push --accept-data-loss` como implantação. O backup local está em `db/custom.db.backup.20261010T180502Z` (ignorado por Git).

## Configuração e verificação

`MEDIA_METRICS_URL` deve apontar para `/metrics` do MediaMTX em **loopback HTTP**. O caminho publicado para a sessão é `session-<sessionId>`. Sem configuração, o painel mostra a ausência de métricas e impede confirmar sinal. A resposta da API não inclui URL de ingestão nem segredo.

- `prisma validate`: passou com `DATABASE_URL` definido; cliente Prisma gerado.
- Migração aplicada primeiro em cópia da base; `PRAGMA foreign_key_check` vazio e `prisma migrate diff` indicou **nenhuma diferença** entre a cópia migrada e o schema.
- `bun run typecheck`, `bun run lint` e `bun run test:media:domain`: passaram.
- Integração local com cópia temporária da base e métricas simuladas: anônimo **401**, usuário de outra Câmara **403**, preparo/replay, conflito de versão, bloqueio sem sinal, acompanhamento, `signal_lost` e encerramento funcionaram. Resultado persistido: **3 comandos, 3 auditorias e 3 eventos internos**. O teste não usou rede social nem alterou sessões reais.
- `bun run build`: **passou**, incluindo TypeScript e rota nova. O sandbox não alcança Google Fonts; a repetição com acesso à rede compilou e gerou o pacote standalone.

## Limites e próxima fatia

O painel ainda **não** inicia/para OBS, não configura destinos, não comprova publicação social, gravação contínua ou recuperação de WAN. O estado `monitoring` é local. A checagem de `sourceReady` e a escrita não são atômicas com o serviço de mídia; o sinal pode cair logo após o comando, caso em que o GET retorna `signal_lost`. O modelo atual de papéis não inclui operador audiovisual dedicado.

A próxima fatia deve integrar um controlador de mídia autenticado, destinos independentes e confirmação real de saída RTMPS/gravação; separar o papel audiovisual; guardar chaves em cofre; construir prévia e incidentes; ensaiar falha/reconexão. A homologação com a Câmara piloto exigirá câmeras, áudio, rede e conta institucional, além de aceite operacional para iniciar/parar uma live real.
