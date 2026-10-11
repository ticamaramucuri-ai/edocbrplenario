# Runbook Operacional — Legis SaaS

Procedimentos para operar o ambiente (sandbox/piloto). Público: equipe técnica da
plataforma e da Câmara.

---

## 1. Arquitetura do ambiente

| Serviço | Porta | Papel | Como sobe |
|---|---|---|---|
| Next.js (app + API `/api/v1`) | 3000 | SPA, API REST, SSR | `bun run dev` |
| Realtime (socket.io) | 3003 | Publica eventos do outbox p/ salas `tenant:{id}` e `public:{id}` | `cd mini-services/realtime && bun run dev` |
| Webhooks | 3004 | Entrega HMAC de `WebhookDelivery` com retry/dead-letter | `cd mini-services/webhooks && bun run dev` |
| Scheduler | 3005 | Jobs e alertas periódicos | `cd mini-services/scheduler && bun run dev` |
| Gateway (Caddy) | 81/443 | Única porta externa; WebSocket/HTTP com `?XTransformPort={porta}` | gerenciado pelo sandbox |

Banco: **SQLite** em `db/custom.db` (WAL) via Prisma (`prisma/schema.prisma`).

### Identidade e tempo real (etapa 001)

- `REALTIME_AUTH_SECRET`: segredo aleatório compartilhado pelo Next.js e pelo serviço
  realtime, com pelo menos 32 bytes. Configure via gerenciador de segredos/ambiente;
  nunca coloque o valor em Git. Sem ele, salas internas não autorizam conexão.
- `LEGIS_DEMO_MODE=true`: habilita o antigo acesso por perfis apenas em ambiente que
  não seja `NODE_ENV=production`. A ausência dessa variável exige login por senha.
- `REALTIME_DB_PATH`: caminho absoluto opcional para o SQLite lido pelo serviço realtime;
  por padrão usa `db/custom.db` do projeto. Use a mesma base configurada em
  `DATABASE_URL` na API.
- Para ensaio PostgreSQL do realtime, defina `REALTIME_DATABASE_PROVIDER=postgresql`
  e `DATABASE_URL` PostgreSQL, após gerar o cliente Prisma para esse provedor.
  Execute apenas um publicador por banco; a migração integral da aplicação ainda
  está em andamento na [etapa 030](etapas/030-base-operacional-saas.md).
- Para ensaio PostgreSQL dos webhooks, defina `WEBHOOKS_DATABASE_PROVIDER=postgresql`
  e `DATABASE_URL` PostgreSQL com cliente Prisma correspondente. Execute um
  trabalhador por banco até implementar claim/lease. O piloto continua usando
  `WEBHOOKS_DB_PATH` e SQLite; veja a [etapa 034](etapas/034-webhooks-postgres.md).
- Para ensaio PostgreSQL do scheduler, gere o cliente Prisma correspondente,
  defina `DATABASE_URL` PostgreSQL e use `cd mini-services/scheduler && bun run dev:postgres`.
  Execute uma instância por banco até haver claim/lease para jobs; o piloto usa
  `bun run dev`. Consulte a [etapa 035](etapas/035-scheduler-postgres.md).
- O ensaio conjunto e as migrações SQL iniciais estão descritos na
  [etapa 036](etapas/036-ensaio-integrado-postgres.md). O baseline 0001 só pode
  ser aplicado em banco PostgreSQL vazio; o rollback 0002 remove apenas índices.
- O frontend obtém uma concessão de 120 segundos em `/api/v1/realtime/token`; o
  mini-serviço valida assinatura e tenant. A conexão interna se renova após vencimento.
- Verificação local: `bun run test:security`; com API e realtime no ar, autentique-se,
  salve apenas temporariamente o JSON de `/api/v1/realtime/token` e execute
  `TEST_TOKEN_PATH=/caminho/temporario/token.json bun run test:realtime:smoke`.

Os comandos antigos abaixo pressupõem o ambiente de demonstração do sandbox. Antes de
usá-los, defina as variáveis acima no mesmo ambiente dos processos; em produção, use
orquestração e segredos gerenciados.

### Subir tudo (após reinício do sandbox)

```bash
cd /home/z/my-project
# Next.js (orfanado — sobrevive ao fim do comando)
(nohup bun run dev > /dev/null 2>&1 < /dev/null &)
# Realtime e Webhooks
(cd mini-services/realtime && nohup bun run dev > service.log 2>&1 < /dev/null &)
(cd mini-services/webhooks && nohup bun run dev > service.log 2>&1 < /dev/null &)
```

> **Importante:** `nohup ... &` direto morre quando o comando Bash termina — use o padrão
> com subshell `( ... & )` acima (PPID 1).

### Health checks

```bash
curl -s localhost:3000/api/v1/bootstrap | head -c 50   # API no ar
curl -s "localhost:3003/health?XTransformPort=3003"    # {"ok":true}
curl -s "localhost:3004/health?XTransformPort=3004"    # {"ok":true}
```

---

## 2. Mudanças de schema (Prisma)

```bash
bun run db:push       # aplica schema (destructive aceito no script)
bun run db:generate   # regenera o client
# REINICIAR o dev server — o client Prisma fica em memória:
pkill -f "next dev"; sleep 2; cd /home/z/my-project && (nohup bun run dev > /dev/null 2>&1 < /dev/null &)
```

Sem o restart, rotas novas retornam `TypeError: Cannot read properties of undefined
(reading 'findMany')` (client antigo em memória).

## 3. Re-seed da base de demonstração

```bash
bun prisma/seed.ts
```

Recria: tenant Vila Nova (13 vereadores, 25 matérias, 3 sessões, estrutura institucional,
tramitação, protocolo, tarefas, planos/assinatura) **e** tenant Serra Azul (9 vereadores,
5 matérias, 2 sessões, trial). **Apaga tudo antes** — nunca rode com dados reais.

Fases 9–12 no seed: senhas de login (`DemoLegis!2026` para ana.ribeiro@, carla.mendes@,
marta.lima@ e suporte@legissaas.dev + usuário inativo tiago.almeida@), 5 faturas (2 pagas
Vila Nova + 1 aberta + Serra Azul com 1 paga e **1 VENCIDA** para demonstrar dunning no
ciclo), 5 publicações (1 revogada) e 3 audiências (1 aberta com 3 perguntas + 1 encerrada
respondida).

Onda 4 (v0.11.0) no seed: **joao.prado@legissaas.dev** (Suporte da Plataforma, mesma
senha demo) com uma impersonação ENCERRADA auditada (ticket #1042), PL 49 vetado (prazo
de apreciação + tarefa), PL 41 sancionado, EM 12 emenda vinculada ao PL 44, votação
pronta com opções regimentais, recibos determinísticos do REQ 120, 5 assinaturas de
cidadãos (4 Vila Nova — 3 confirmadas), 2 alertas (1 aberto, 1 reconhecido) e 1 job de
exportação concluído.

v0.12.0 no seed: tabelas **RoadmapPhase** (4 fases F21–F24 da Onda 5) e
**RoadmapTask** (**34 tasks** — F21 8 · F22 9 · F23 8 · F24 9, espelhando o ROADMAP
§12.1–12.4), progresso inicial 0/34 (todas `pendente`).

> **Módulo Planejamento e Roadmap — notas operacionais (v0.12.0):**
>
> - Sem dependência extra: mesma API (porta 3000) e mesmo banco — nenhum serviço
>   novo para subir.
> - `PATCH /api/v1/roadmap/tasks/:id` exige `platform_owner` (permissão
>   `platform.manage`): **403 para os demais papéis é o comportamento esperado**
>   (a leitura via `GET /api/v1/roadmap` vale para qualquer autenticado).
> - **Re-seed zera o progresso das tasks** (status volta a `pendente`, sem
>   autor/horário) — comportamento conhecido: o roadmap da base demo representa o
>   plano no estado inicial da Onda 5.
> - A alteração de status fica registrada na própria linha da task
>   (`updatedByName`/`updatedAt`) — artefato de plataforma, fora da cadeia de
>   auditoria de tenant (padrão do `SystemStatus`).

> Após re-seed, sessões de login (`AuthSession`) são zeradas e o `legis.actorId` no
> localStorage do navegador fica obsoleto — o app detecta e reabre o gate de entrada.

## 4. Observabilidade

- **Logs do app**: `dev.log` (queries Prisma + erros com `correlationId`).
- **Serviços**: `mini-services/*/service.log` (JSON conciso: conexões, lotes publicados,
  entregas, retries).
- **Erros de API**: todo erro retorna Problem Details com `correlationId` — cruze com o
  log do app.
- **Cadeia de auditoria**: `Governança → Auditoria → Verificar cadeia` (ou
  `GET /api/v1/audit?verify=true`).
- **Entregas de webhook**: módulo Webhooks → Entregas (status/tentativas/erro por entrega).
- **Console → aba Sistema** (Fase 16, `platform_owner`): forma rápida de conferir a saúde
  dos mini-serviços 3003/3004 (com latência), tamanho do banco/WAL, filas (outbox e
  webhooks) e alertas derivados — atualiza a cada 30s. Os health checks degradam para
  "Parado" (nunca 500): um serviço nesse estado já aponta a ação deste runbook (§1 subir
  novamente / §6.2–§6.4 para diagnóstico).

## 5. Backup e restauração (SQLite)

```bash
# Backup consistente (WAL checkpoint incluso)
sqlite3 db/custom.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
cp db/custom.db backups/custom-$(date +%Y%m%d-%H%M).db

# Restauração (parar serviços que escrevem antes)
pkill -f "next dev"; pkill -f "mini-services" # (ajuste aos processos reais)
cp backups/custom-YYYYMMDD-HHMM.db db/custom.db
# religar serviços (§1)
```

Verificação pós-restauração: health checks (§1) + `GET /api/v1/audit?verify=true` →
`chain.valid: true` + conferir sessão demo nº 2 (hoje 19h, scheduled).

## 6. Procedimentos de incidente

### 6.1 Sessão offline (perda de internet no plenário)

1. A mesa continua registrando localmente o que o operador digitar quando a conexão volta
   (comandos idempotentes por `commandId`).
2. O telão se reconstrói por snapshot (`/api/v1/public/live`) ao reconectar.
3. Após restabelecimento: conferir quórum e votações em andamento na Mesa do Plenário;
   verificar em Auditoria se houve comandos duplicados (idempotência impede duplicidade).
4. **Fechamento de votação durante offline** só ocorre com a API alcançável — não existe
   fechamento local de alto impacto (decisão do ADR-003).

### 6.2 Fila de webhooks travada

1. `Webhooks → Entregas`: identificar endpoint com entregas `pending` antigas.
2. Verificar `mini-services/webhooks/service.log` (timeout/DNS/HTTP 5xx do receptor).
3. Corrigir o receptor (ou desativar o endpoint) e usar `Reprocessar` por entrega.
4. Dead-letters (`dead`) notificam o tenant_admin; reenvio manual auditado.

### 6.3 Rotação de segredo de webhook

1. `Webhooks → Editar` — novo segredo é gerado; **comunique o receptor imediatamente**
   (entregas no intervalo usam o segredo novo).
2. Testar com `Testar` (test.ping) e conferir a assinatura no receptor.

### 6.4 Eventos de tempo real não chegam

1. Status de conexão na sidebar (`Conectado`?).
2. `curl localhost:3003/health` — serviço de pé? Ver `service.log`.
3. Em SQLite, o serviço é somente leitura e usa checkpoint próprio
   (`mini-services/realtime/checkpoint.json`). Em PostgreSQL, confira os eventos
   `pending`; falha de emissão mantém o evento pendente para nova tentativa.
4. Clientes refazem subscribe automaticamente (reconexão com backoff no hook).

### 6.5 SQLITE_BUSY / timeout de escrita

- Escritas são serializadas (mutex in-process + `connection_limit=1`, ADR-003). Se ocorrer
  em volume alto: verificar se algum script externo escreve no banco concorrentemente
  (mini-serviços devem ser read-only ou usar busy_timeout/retry — padrão do webhooks).

## 7. Suporte e impersonação (Fase 20)

O papel `platform_support` (login real: `joao.prado@legissaas.dev` / `DemoLegis!2026`)
operaciona a plataforma e pode **operar como um usuário de uma Câmara** para reproduzir
um problema relatado.

**Como operar como usuário** (módulo *Administração → Suporte da Plataforma*):

1. Entre com e-mail e senha — a impersonação exige **sessão autenticada** (o modo de
   perfis demo `x-actor-id` responde 409 e não impersona).
2. "Operar como usuário": escolha o alvo (usuários ativos com tenant — papéis da
   plataforma NUNCA aparecem), descreva o **motivo (≥ 10 caracteres)** e o prazo
   (5–60 min). Enquanto ativa, TODAS as rotas enxergam o ator-alvo (mesmo escopo/RBAC
   da Casa) e o **banner âmbar** no topo mostra suporte, alvo e contagem regressiva.
3. **Encerrar**: botão "Encerrar agora" no banner, a expiração automática (lazy, na
   próxima leitura da sessão) ou o logout do suporte — as três vias encerram e limpam
   as sessões acopladas.

**Onde fica a auditoria**: os eventos `support.impersonation_started` e
`support.impersonation_ended` são gravados **na cadeia do TENANT-ALVO** (módulo
Auditoria da Casa), com actorName "Nome (Suporte)", motivo e prazo — a Casa enxerga
exatamente quando o suporte operou como quem.

## 8. Exportação assíncrona (Fase 20)

`POST /api/v1/platform/tenants/:id/export` cria um **job** (resposta 202) processado por
um worker **in-process** com progresso real (0–100%); o download
(`/api/v1/platform/exports/:id/download`) **regenera o snapshot no momento do pedido**
(header `X-Export-Snapshot`), com o mesmo shape do export anterior e sem segredos.

- **Job órfão em `running` após restart**: o worker não sobrevive ao processo — se o dev
  server reiniciar durante um job, ele fica `running` para sempre. A guarda de
  concorrência (um job pending/running por tenant → 409) persiste, então nenhum novo
  job nasce até resolver:
  1. Interpretação: job `running` com progresso parado por vários minutos = órfão
     (verifique o `dev.log` — jobs reais logam `[export-job xxxxxx] estágio…`).
  2. Resolver: zere o registro via Prisma ou simplesmente re-seede a base (§3);
     em produção o worker dedicado retomará jobs da fila.
- **Recriar**: após limpar/anular o órfão, um novo POST cria outro job normalmente.
- **Download em job não concluído** → 409 com o estado atual (comportamento esperado).

## 9. Migração de dados (resumo operacional)

Guia completo: `docs/migration-importer.md`. Ordem: `Inspecionar → Validar → Planejar →
Simular → Importar → Reconciliar → Relatório → Homologar` (ou Rollback antes de homologar).
Rollback remove apenas os dados do run — seguro para reimportações.

## 10. Limitações conhecidas do ambiente (declaradas)

| Limitação | Impacto | Caminho de produção |
|---|---|---|
| Autenticação demo via `x-actor-id` | Sem senha/MFA real; NÃO permite impersonação (409) | OIDC + MFA (prompt mestre §11) — matriz RBAC já idêntica |
| SQLite single-writer | Sessões concorrentes de ESCRITA entre tenants serializam | PostgreSQL com RLS (mesma modelagem multi-tenant) |
| Voto secreto = sigilo operacional (valor oculto), não criptográfico | DBA poderia teoricamente correlacionar | Desenho criptográfico com revisão de especialista |
| Webhooks dependem de saída de internet | Alvos externos podem falhar em sandbox | Eco local para demonstração; rede liberada em produção |
| Desativação de tenant é operacional (não bloqueia rotas) | Console reflete status financeiro | Middleware de bloqueio server-side quando ativado |
| Rate limit público em memória por processo (Fase 19) | Reinicia com o dev server; sem efeito multi-réplica | Redis por bucket (contrato `hitRateLimit` estável) — ADR-020 |
| Worker de export in-process (Fase 20) | Job órfão em running após restart (guarda 409 persiste) | Fila persistente + worker dedicado — ver §8 |

## 11. Checklist diário (em operação assistida)

- [ ] Health checks dos 3 serviços OK
- [ ] Auditoria: cadeia válida
- [ ] Notificações: sem dead-letter novo
- [ ] Sessão do dia: pauta publicada e portal exibindo
- [ ] Alertas persistentes: sem abertos ignorados (Console → Sistema / Suporte)
- [ ] Backup diário executado e testado (restauração semanal)
