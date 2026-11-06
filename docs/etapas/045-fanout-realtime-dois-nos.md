# Etapa 045 — Fanout realtime em dois nós

**Data:** 13/10/2026 · **Estado:** incremento técnico e prova sintética local aprovados; operação distribuída institucional pendente.

O mini-serviço Socket.IO aceita `REALTIME_REDIS_URL` quando usa PostgreSQL. Nesse modo, usa o [adaptador oficial Redis Streams do Socket.IO](https://socket.io/docs/v4/redis-streams-adapter/) para encaminhar eventos às salas de outros nós. O Redis não é exposto em porta do host na stack de homologação. O health retorna 503 e o poller deixa a outbox pendente quando a conexão principal com Redis não está pronta. Sem essa variável, o serviço conserva o modo local, usado pelo SQLite de desenvolvimento. A stack sintética sobe um Redis interno; um segundo nó existe apenas no perfil `fanout-lab`.

`bun scripts/staging-realtime-fanout.ts` exige que a base contenha somente `staging-example`, inicia o segundo nó, conecta um cliente interno e um público em cada nó, grava um evento na outbox e exige que os quatro recebam o mesmo `eventId`. O campo interno não aparece nos dois clientes públicos. A prova interrompe o Redis, espera health degradado nos dois nós, grava outro evento, confirma que ele continua `pending`, restaura o Redis e exige entrega aos quatro clientes e estado `published`. O script para o nó de laboratório e religa o Redis em `finally`.

```bash
python3 scripts/staging-build.py
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yaml up -d --no-build redis realtime
bun scripts/staging-realtime-fanout.ts
```

[Evidência estruturada](045-prova-fanout-realtime-dois-nos.json). O teste confirmou dois nós, quatro assinantes, separação de payload interno/público, publicação da outbox e retomada após parada controlada do Redis. `bun run typecheck`, `bun run lint`, smoke da API e observação saudável da stack também passaram.

**Limites:** todos os processos estão no mesmo host, o Redis do laboratório não persiste seu stream e não há balanceador de clientes, segunda máquina nem carga prolongada com dois nós. O adaptador usa escrita assíncrona no stream; uma queda na janela entre o início da emissão e a confirmação na outbox ainda precisa de ensaio e mecanismo de reconciliação antes de prometer entrega sem lacunas. Clientes devem reconstruir o estado a partir das APIs após reconectar. Em produção, Redis precisa de rede privada, autenticação, TLS/ACL conforme a implantação e retenção dimensionada; o [guia oficial](https://socket.io/docs/v4/redis-streams-adapter/) alerta que mensagens no Redis contêm dados do evento. Nextcloud e Alfresco continuam nas fases finais.
