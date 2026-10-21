# edocBR Plenário — instruções do projeto

Complementa o `CLAUDE.md` de `~/Work` (fluxo local → GitHub → VPS, idioma,
segurança). Aqui ficam só as informações próprias deste repositório.

Documento de referência para a ordem do trabalho:
[`docs/PLANO-CONTINUIDADE-2026-10-20.md`](docs/PLANO-CONTINUIDADE-2026-10-20.md).

## Stack

| Camada | Tecnologia |
|---|---|
| App + API | Next.js 16 (App Router, rota única `/`) · React 19 · TypeScript estrito |
| UI | Tailwind CSS 4 · shadcn/ui (New York) · Lucide · TanStack Query |
| Dados | Prisma 6 + SQLite (`db/custom.db`, WAL) na instalação ativa; PostgreSQL só na homologação em contêiner |
| Tempo real | socket.io — mini-serviço na porta 3003, alimentado por outbox transacional |
| Webhooks | mini-serviço na porta 3004 (HMAC + retry/dead-letter) |
| Scheduler | mini-serviço na porta 3005 (jobs e alertas periódicos) |
| Correio | worker `bun run mail:worker`, health local na 3006 |
| Gateway | Caddy na porta 81 (única porta externa; `?XTransformPort={porta}` encaminha para os serviços) |
| Testes | `bun test` · Playwright + axe-core para acessibilidade · Docker Compose para homologação |
| Runtime | Bun 1.4.2 |

Domínio em `src/lib/server/*`; API em `src/app/api/v1/*`; mini-serviços em
`mini-services/{realtime,webhooks,scheduler}`.

## Comandos

### Instalar

```bash
bun install --frozen-lockfile
bun install --cwd mini-services/realtime --frozen-lockfile
bun run db:generate
```

Conferido: `Checked 858 installs across 927 packages (no changes)`.

### Rodar

```bash
bun run dev                                   # app na porta 3000
(cd mini-services/realtime  && bun run dev)   # porta 3003
(cd mini-services/webhooks  && bun run dev)   # porta 3004
(cd mini-services/scheduler && bun run dev)   # porta 3005
bun run mail:worker                           # health em 127.0.0.1:3006
```

Conferido com os quatro de pé:

| Verificação | Saída |
|---|---|
| `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/` | `200` |
| `curl .../api/v1/bootstrap` | `200` |
| `curl http://127.0.0.1:3003/health` | `{"ok":true,"service":"legis-realtime","fanout":"local","port":3003,...}` |
| `curl http://127.0.0.1:3004/health` | `{"ok":true,"service":"legis-webhooks","port":3004,...}` |
| `curl http://127.0.0.1:3005/health` | `{"ok":true,"service":"scheduler","port":3005}` |

Linha de pronto dos serviços (log JSON): `"msg":"serviço de webhooks iniciado"`,
`"msg":"scheduler iniciado"`.

Variáveis de ambiente que mudam o comportamento da execução local:

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | base Prisma. No `.env.local` é relativa ao diretório `prisma/` (`file:../db/custom.db`) |
| `REALTIME_AUTH_SECRET` | segredo ≥ 32 bytes, **igual** no app e no serviço realtime; sem ele as salas internas não autorizam |
| `LEGIS_DEMO_MODE=true` | habilita a entrada por perfis de demonstração fora de produção |
| `NEXT_PUBLIC_REALTIME_URL` | **obrigatória quando não há gateway Caddy** (ex.: `http://localhost:3003`); sem Caddy e sem ela o cliente tenta `/?XTransformPort=3003` e nunca conecta |
| `DEFAULT_TENANT_SLUG` | Câmara usada na tela de entrada |
| `EDOCBR_ALLOW_DEV_DB=1` | escape explícito da guarda de banco dos testes |

### Testar

```bash
bun run lint          # eslint .  — sem saída quando passa
bun run typecheck     # tsc --noEmit — sem saída quando passa
bun run test:unit                          # guarda de banco + endereço do tempo real
bun run test:clean:test-tenants            # limpeza de tenants de teste
bun run test:security                      # realtime-auth + demo-mode
```

Os demais gates estão em `package.json` (prefixos `test:*`) e no job
`application` de [`.github/workflows/ci.yml`](.github/workflows/ci.yml), que é o
gate real: todo comando de teste novo entra lá.

Teste que precisa de banco roda por um wrapper `scripts/test-*.sh`, que cria
SQLite temporário em `/tmp` e só então chama `bun test`. **Nunca** aponte
`DATABASE_URL` para `db/custom.db` ao rodar teste: o preload de `bunfig.toml`
(`tests/guard-dev-database.ts`) derruba a execução antes do primeiro teste.

A guarda confere a `DATABASE_URL` do ambiente e, quando ela não está definida, a
do `.env.local` — que é o valor que o processo usaria se alguém reintroduzisse o
carregamento. Por isso `bun test <arquivo>` solto também é barrado nesta
instalação: use um wrapper, `bun run test:unit` (que aponta para `/tmp`) ou
`EDOCBR_ALLOW_DEV_DB=1` para assumir a escrita.

### Build

```bash
bun run build   # next build + cópia de static/public para .next/standalone
bun run start   # NODE_ENV=production bun .next/standalone/server.js
```

### Operação da base

```bash
bun run db:backup:bundle                    # pacote verificável banco + mídia
bun run db:clean:test-tenants               # simulação (padrão)
bun run db:clean:test-tenants --apply       # grava backup e remove tenants de teste
bun run db:register:mucuri                  # cadastro idempotente da Câmara real
bun prisma/seed.ts                          # só em base descartável de demonstração
```

## Deploy

**Este projeto não tem VPS.** Decisão de 21/10/2026: todo o desenvolvimento
segue local, e nenhum ambiente de produção ou homologação remoto existe hoje.

O que isso implica, enquanto a decisão valer:

- O ciclo do `CLAUDE.md` de `~/Work` para neste projeto em **GitHub**: local →
  branch → push → merge na `main`. Não há passo de deploy.
- Não invente host, usuário, pasta ou comando de reinício. Se alguém pedir
  deploy, a resposta é que o ambiente não existe e precisa ser decidido antes.
- A homologação em contêiner (`deploy/staging/compose.yaml`) roda **na própria
  máquina de desenvolvimento**. Isso não é host separado: a trilha B do plano de
  continuidade (prova de operação fora do host, recuperação medida, matriz de
  falhas com observador externo) continua **bloqueada** por falta de host, e
  nenhum ensaio local a substitui.
- `bun run build` + `bun run start` servem o bundle de produção localmente, para
  ensaio e auditoria — não é publicação.

Repositório remoto: `https://github.com/lsjlima/edocBR_Plenario.git`.

## Regras do projeto

- **Nenhum dado oficial por suposição.** Legislatura, mandatos, Mesa, partidos,
  destinatários e sessões de Mucuri/BA só entram com dado fornecido pela Câmara.
  Ensaio usa tenant sintético. Mucuri está cadastrada sem usuários e sem dados
  oficiais — isso é o estado correto, não uma pendência a preencher de improviso.
- **Voto secreto oficial permanece bloqueado** em
  `src/lib/server/voting-service.ts`, e votação offline não existe. Só a trilha F
  do plano de continuidade pode reabrir isso, e só se a Câmara exigir.
- **Teste nunca escreve em `db/custom.db`.** Use wrapper com banco temporário.
- **Toda etapa gera documento.** Ensaio grava `docs/etapas/0NN-*.md` (narrativa +
  limites) e, quando houver medição, `docs/etapas/0NN-prova-*.json` com números
  datados. Número observado nunca é apresentado como meta institucional.
- **Ao fim de cada tarefa**, atualizar `docs/etapas/README.md`,
  `docs/CHANGELOG.md` e `docs/PENDENCIAS-PRIORIZADAS.md`.
- **Ensaio local não fecha pendência institucional**, e documento não fecha
  pendência técnica.
- `worklog.md`, `dev.log`, `tool-results/`, `agent-ctx/` e `.superpowers/` são
  artefatos de ferramenta, não fonte de verdade.
