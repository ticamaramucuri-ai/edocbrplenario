# Plano de continuidade do desenvolvimento — edocBR Plenário

> **Registro histórico de continuidade.** Consulte o [plano mestre vigente](PLANO-MESTRE.md) para o estado atual da VPS, backup, desktop e piloto.

> **Para quem executa:** cada tarefa é independente e termina com entrega testável, prova reproduzível e commit. Use `superpowers:executing-plans` (execução direta) ou `superpowers:subagent-driven-development` (um implementador e um revisor por tarefa). Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** levar o piloto do estado "funciona na máquina de desenvolvimento" ao estado "opera fora do host, com prova de recuperação e pacote de aceite pronto para a Câmara" — sem inventar dado oficial e sem reabrir módulo já entregue.

**Arquitetura:** monolito Next.js 16 (App Router, rota única com troca de módulos no cliente) servindo `/api/v1`, com domínio em `src/lib/server/*`, outbox transacional e três mini-serviços (realtime 3003, webhooks 3004, scheduler 3005) atrás de um gateway Caddy. Dados em Prisma: SQLite na instalação ativa, PostgreSQL na homologação em contêiner.

**Stack:** Bun 1.4.2 · Next.js 16 · React 19 · TypeScript estrito · Prisma 6 · socket.io · Tailwind 4/shadcn · Playwright + axe-core · Docker Compose (homologação).

**Base documental:** [`PLANO-ATUALIZADO-2026-10-13.md`](PLANO-ATUALIZADO-2026-10-13.md) (ordem das fases), [`DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md`](DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md) (lacunas), [`PENDENCIAS-PRIORIZADAS.md`](PENDENCIAS-PRIORIZADAS.md) (responsáveis) e [`etapas/README.md`](etapas/README.md) (estado por etapa). Este plano não substitui nenhum deles: traduz a ordem já decidida em tarefas executáveis e acrescenta os achados da análise de 20/10/2026.

---

## Restrições globais

Valem para toda tarefa; não se repetem nos passos.

- **Idioma:** código, comentários, commits e documentos em português do Brasil. Commit no padrão `tipo(escopo): descrição`.
- **Branch por tarefa:** `git switch -c tipo/nome-curto`; merge na `main` só depois de `bun run lint`, `bun run typecheck` e os gates da tarefa passarem.
- **Nunca** commitar `.env`, chaves, `db/*.db` ou backups. Conferir `git diff --cached` antes do commit.
- **Nenhum dado oficial por suposição:** legislatura, mandatos, Mesa, partidos, destinatários e sessões de Mucuri só entram com dado fornecido pela Câmara. Ensaios usam tenants sintéticos.
- **Voto secreto oficial permanece bloqueado** (`src/lib/server/voting-service.ts`) e votação offline não existe — nenhuma tarefa aqui reabre isso, exceto a trilha F, que é condicional.
- **Toda prova é arquivo:** cada tarefa de ensaio grava `docs/etapas/0NN-*.md` (narrativa + limites) e, quando houver medição, `docs/etapas/0NN-prova-*.json` (números com data). Falha em divergência, nunca aviso.
- **Atualizar sempre no fim da tarefa:** `docs/etapas/README.md`, `docs/CHANGELOG.md` e `docs/PENDENCIAS-PRIORIZADAS.md`.
- **CI é o gate:** tarefa que cria comando de teste acrescenta a linha correspondente em `.github/workflows/ci.yml`.

## Foco de revisão

Cinco comportamentos que o sistema já apresenta e que nenhum teste cobre hoje. Cada linha tem a tarefa que a fecha.

1. **Teste executado direto grava na base de desenvolvimento.** `bun test tests/attendance-commands.test.ts` importa `@/lib/db`, lê o `.env.local` e escreve em `db/custom.db` — só os wrappers `scripts/test-*.sh` isolam o banco. Hoje há 15 tenants de teste (`attendance-*`, `tally-*`, `mail-*`, `camara-a/b-*`) na base ativa, contra 3 reais. → **Tarefa 1**.
2. **Sem Caddy o tempo real nunca conecta.** `src/hooks/use-realtime.ts` aponta para `/?XTransformPort=3003`; sem o gateway a topbar fica em "Conectando…" para sempre, sem erro visível. Foi necessário `NEXT_PUBLIC_REALTIME_URL` para subir o app nesta máquina. → **Tarefa 3**.
3. **Tenant padrão vazio produz entrada sem saída.** `DEFAULT_TENANT_SLUG=camara-mucuri-ba` tem zero usuários; o bootstrap devolve só os dois atores de plataforma e a tela não explica por quê. → **Tarefa 4**.
4. **Quatro perfis de demonstração não têm senha.** `roberto.nogueira` (presidência), `marcos.vieira` (operador), `paula.andrade` (legislativo) e `helena.costa` (auditor) existem com `passwordHash` nulo: o login por senha falha para justamente os papéis da Mesa. → **Tarefa 5**.
5. **Backup do banco não carrega os bytes.** Fotos, emblemas, gravações e replay vivem em diretórios; o restore precisa provar banco **e** arquivos juntos, em host separado, com tempo medido. → **Tarefa 9**.

---

# Trilha A — Fundamentos do repositório

Sem dependência externa. Fecha os cinco achados acima e deixa o ambiente previsível para quem chegar depois. Ordem recomendada: 1 → 2 → 3 → 4 → 5 → 6.

### Tarefa 1: Guarda de banco nos testes e limpeza da base de desenvolvimento

**Arquivos:**
- Criar: `tests/guard-dev-database.ts` (preload), `bunfig.toml`, `scripts/clean-test-tenants.ts`
- Criar teste: `tests/database-guard.test.ts`
- Modificar: `package.json` (script `db:clean:test-tenants`), `.github/workflows/ci.yml`

**Interfaces:**
- Produz: `assertDisposableDatabase(databaseUrl: string, repoRoot: string): void` — lança `Error` quando a URL aponta para `db/` do repositório e `EDOCBR_ALLOW_DEV_DB` não é `1`.
- Consome: nada.

- [ ] **Passo 1: escrever o teste que falha** — `tests/database-guard.test.ts`

```ts
import { expect, test } from 'bun:test'
import { assertDisposableDatabase } from './guard-dev-database'

const root = '/repo'

test('recusa a base de desenvolvimento do repositório', () => {
  expect(() => assertDisposableDatabase('file:/repo/db/custom.db', root)).toThrow(/descartável/)
})

test('aceita banco temporário', () => {
  expect(() => assertDisposableDatabase('file:/tmp/edocbr-x.db', root)).not.toThrow()
})

test('aceita PostgreSQL de homologação', () => {
  expect(() => assertDisposableDatabase('postgresql://edocbr_stage@127.0.0.1:55432/edocbr_stage', root)).not.toThrow()
})

test('permite escape explícito', () => {
  process.env.EDOCBR_ALLOW_DEV_DB = '1'
  expect(() => assertDisposableDatabase('file:/repo/db/custom.db', root)).not.toThrow()
  delete process.env.EDOCBR_ALLOW_DEV_DB
})
```

- [ ] **Passo 2: rodar e ver falhar** — `bun test tests/database-guard.test.ts` · esperado: FAIL (`Cannot find module './guard-dev-database'`).
- [ ] **Passo 3: implementar** `assertDisposableDatabase` em `tests/guard-dev-database.ts`. O módulo também roda como preload: no topo, se `process.env.DATABASE_URL` existir, chama a própria guarda com `import.meta.dir + '/..'` como raiz. Caminho relativo (`file:./db/custom.db`) é resolvido contra a raiz antes da comparação.
- [ ] **Passo 4: ligar o preload** — criar `bunfig.toml` com `[test]` e `preload = ["./tests/guard-dev-database.ts"]`.
- [ ] **Passo 5: provar que a guarda pega o caso real** — `bun test tests/attendance-commands.test.ts` sem override · esperado: FAIL com a mensagem da guarda, **sem** criar tenant. Confirmar com `sqlite3 db/custom.db "select count(*) from Tenant;"` (número inalterado).
- [ ] **Passo 6: escrever a limpeza** — `scripts/clean-test-tenants.ts` remove, em cascata e dentro de uma transação, os tenants cujo slug casa `^(attendance|self-attendance|tally|mail|scan-mail|camara-a|camara-b)-[0-9a-f-]{8,}` e os que não estão em `('camara-vila-nova','camara-serra-azul','camara-mucuri-ba')`. Modo padrão `--dry-run` imprime o que removeria; `--apply` executa depois de gravar backup com `python3 scripts/backup-bundle.py`.
- [ ] **Passo 7: rodar em simulação e depois aplicar** — `bun scripts/clean-test-tenants.ts` (listar 15) e `bun scripts/clean-test-tenants.ts --apply`. Conferir: `sqlite3 db/custom.db "select slug from Tenant;"` devolve exatamente os três reais.
- [ ] **Passo 8: CI** — acrescentar `- run: bun test tests/database-guard.test.ts` ao job `application`.
- [ ] **Passo 9: commit**

```bash
git add bunfig.toml tests/guard-dev-database.ts tests/database-guard.test.ts scripts/clean-test-tenants.ts package.json .github/workflows/ci.yml
git commit -m "test(infra): impedir escrita de teste na base de desenvolvimento"
```

### Tarefa 2: `CLAUDE.md` do projeto

**Arquivos:**
- Criar: `CLAUDE.md` (raiz)

**Interfaces:** consome a topologia real de portas e os scripts de `package.json`; produz o contrato que as próximas sessões vão seguir.

> **Entrada necessária do responsável:** host, usuário, pasta da aplicação e comando de reinício da VPS. Sem isso, a seção **Deploy** fica com os campos marcados `A DEFINIR` e a tarefa não é considerada fechada.

- [ ] **Passo 1: escrever as seções obrigatórias** — **Stack** (tabela do README), **Comandos** (instalar/rodar/testar/build, incluindo os três mini-serviços e as variáveis `LEGIS_DEMO_MODE` e `NEXT_PUBLIC_REALTIME_URL`), **Deploy** (VPS, pasta, `git pull`, build, restart, health check), **Regras do projeto** (nada de dado oficial presumido; voto secreto bloqueado; toda etapa gera documento; teste nunca escreve em `db/custom.db`).
- [ ] **Passo 2: verificar cada comando documentado** executando-o uma vez e colando a saída esperada (porta, linha de pronto, código do health check).
- [ ] **Passo 3: commit** — `docs(projeto): adicionar CLAUDE.md com stack, comandos e deploy`.

### Tarefa 3: Execução sem gateway Caddy

**Arquivos:**
- Criar: `src/lib/realtime-endpoint.ts`, `tests/realtime-endpoint.test.ts`
- Modificar: `src/hooks/use-realtime.ts:33`, `.env.example`, `docs/runbook.md` (§1)

**Interfaces:**
- Produz: `realtimeEndpoint(env: { NEXT_PUBLIC_REALTIME_URL?: string; NEXT_PUBLIC_REALTIME_GATEWAY?: string }): string` — devolve a URL explícita quando houver, senão `/?XTransformPort=3003`.
- Consome: nada.

- [ ] **Passo 1: escrever o teste que falha** — casos: URL explícita vence; vazio cai no gateway; valor com espaços é ignorado; URL inválida lança erro com nome da variável.
- [ ] **Passo 2: rodar e ver falhar** — `bun test tests/realtime-endpoint.test.ts`.
- [ ] **Passo 3: implementar** `realtimeEndpoint` e usá-la em `ensureSocket` no lugar da expressão inline.
- [ ] **Passo 4: estado visível** — quando o socket não conectar em 15 s, a topbar deve dizer "Tempo real indisponível — verifique o gateway ou `NEXT_PUBLIC_REALTIME_URL`" em vez de permanecer em "Conectando…". O estado já existe em `useApp.connection`; acrescentar o rótulo em `src/components/app/topbar.tsx`.
- [ ] **Passo 5: documentar** — `NEXT_PUBLIC_REALTIME_URL=http://localhost:3003` no `.env.example` com a explicação de que é obrigatória quando não há Caddy; runbook §1 com as duas formas de subir.
- [ ] **Passo 6: verificar no app real** — subir sem Caddy, abrir `http://localhost:3000`, confirmar "Tempo real" na topbar e `cliente inscrito` no log do serviço.
- [ ] **Passo 7: commit** — `fix(realtime): permitir execução sem gateway e expor falha de conexão`.

### Tarefa 4: Entrada previsível com tenant padrão vazio

**Arquivos:**
- Modificar: `src/app/api/v1/bootstrap/route.ts`, `src/components/app/login-form.tsx`
- Criar teste: `tests/bootstrap-empty-tenant.test.ts`

**Interfaces:** o payload de bootstrap ganha `actorsEmptyReason: 'tenant_sem_usuarios' | null`; o front mostra a mensagem correspondente.

- [ ] **Passo 1: escrever o teste que falha** — base descartável com um tenant sem usuários: `GET /api/v1/bootstrap` responde 200, `actors` vazio e `actorsEmptyReason === 'tenant_sem_usuarios'`.
- [ ] **Passo 2: rodar e ver falhar**.
- [ ] **Passo 3: implementar** o campo no serializer do bootstrap e, no `LoginForm`, substituir a lista vazia de perfis por "Esta Câmara ainda não tem usuários cadastrados. Entre com e-mail e senha de outra Câmara ou cadastre o primeiro usuário." quando `demoMode` estiver ligado e `actors` vier vazio.
- [ ] **Passo 4: rodar o teste e ver passar**; conferir a tela com `DEFAULT_TENANT_SLUG=camara-mucuri-ba`.
- [ ] **Passo 5: commit** — `fix(entrada): explicar tenant sem usuários no gate de acesso`.

### Tarefa 5: Perfis de demonstração completos no seed

**Arquivos:**
- Modificar: `prisma/seed.ts`
- Criar: `scripts/test-seed-demo-logins.sh`, `tests/seed-demo-logins.test.ts`
- Modificar: `package.json` (`test:seed:demo-logins`), `.github/workflows/ci.yml`, `README.md` (tabela de credenciais)

- [ ] **Passo 1: escrever o teste que falha** — em base descartável semeada, para cada um dos sete papéis de demonstração, `POST /api/v1/auth/login` com a senha padrão responde 200 e devolve o papel esperado.
- [ ] **Passo 2: rodar e ver falhar** — `bun run test:seed:demo-logins` · esperado: FAIL nos quatro usuários sem `passwordHash`.
- [ ] **Passo 3: implementar** — no seed, gerar `passwordHash` (scrypt, mesma função de `src/lib/server/session.ts`) para **todos** os usuários de demonstração.
- [ ] **Passo 4: rodar e ver passar**; atualizar a tabela de credenciais do README com os sete papéis.
- [ ] **Passo 5: CI e commit** — `fix(seed): dar senha a todos os perfis de demonstração`.

### Tarefa 6: Retenção de backups e ruído do repositório

**Arquivos:**
- Criar: `scripts/prune-local-backups.py`, `docs/runbook.md` §5.1 (retenção)
- Modificar: `.gitignore` (se algum padrão novo aparecer), `package.json` (`db:backup:prune`)

- [ ] **Passo 1: medir** — `du -sh db/` e listar os backups por data (hoje: 31 MB, 32 arquivos de etapa).
- [ ] **Passo 2: escrever o script** — `prune-local-backups.py` mantém os `--keep N` (padrão 5) mais recentes de `db/custom.db.backup.*` e todos os que casarem `--keep-pattern` (etapas citadas em documento). Padrão `--dry-run`; só remove com `--apply`.
- [ ] **Passo 3: rodar em simulação, conferir a lista e aplicar**.
- [ ] **Passo 4: documentar** a retenção no runbook §5 e registrar que `worklog.md`, `dev.log`, `tool-results/` e `agent-ctx/` são artefatos de ferramenta, não fonte de verdade.
- [ ] **Passo 5: commit** — `chore(operacao): definir retenção de backups locais`.

---

# Trilha B — Fechar a fase 045 fora do host de desenvolvimento

É a fase aberta e o maior bloqueio técnico. O laboratório (`deploy/staging/compose.yaml`) já sobe PostgreSQL, Redis, app, realtime, peer de fanout, webhooks, scheduler e Mailpit — **tudo na mesma máquina de desenvolvimento**. As tarefas abaixo movem isso para um host separado e medem recuperação.

> **Entrada necessária:** host de homologação (a VPS do projeto serve), com Docker, volume durável e porta administrativa fechada. Enquanto o host não existir, as tarefas 7–10 ficam bloqueadas; as trilhas A e C seguem em paralelo.

### Tarefa 7: Topologia de homologação documentada e segredos rotacionados

**Arquivos:**
- Criar: `docs/etapas/045-homologacao-fora-do-host.md`, `deploy/staging/README.md`
- Modificar: `deploy/staging/compose.yaml` (bind em interface configurável), `.env.example`

- [ ] **Passo 1: desenhar a topologia** — host, rede, portas expostas (nenhuma pública além do app), volumes (`postgres_data`, `parliamentarian_images`, `media_recordings`, `media_replay`), onde vive cada segredo e quem tem acesso.
- [ ] **Passo 2: rotacionar** `STAGE_DB_PASSWORD`, `STAGE_REALTIME_SECRET` e `STAGE_ADMIN_PASSWORD` com valores novos gerados no host — nunca reaproveitar os do desenvolvimento, nunca imprimir valor em log ou documento.
- [ ] **Passo 3: subir a stack no host** — `docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yaml up -d` e confirmar os cinco health checks.
- [ ] **Passo 4: provar isolamento** — da máquina de desenvolvimento, confirmar que apenas a porta do app responde; `psql` e Redis recusam conexão externa.
- [ ] **Passo 5: registrar a etapa** com limites explícitos ("host dedicado, dados sintéticos, sem tráfego institucional") e commit.

### Tarefa 8: Verificação remota de saúde

**Arquivos:**
- Criar: `scripts/staging-remote-check.py`, `docs/etapas/045-prova-saude-remota.json`
- Modificar: `package.json` (`test:staging:remote-check`)

**Interfaces:** o script recebe `--base-url` e `--expect-services app,realtime,webhooks,scheduler`; sai com 0 só quando todos respondem e os relógios divergem menos de 2 s.

- [ ] **Passo 1: escrever o teste que falha** — apontar para um host inexistente e exigir saída 2 com mensagem nomeando o serviço ausente.
- [ ] **Passo 2: implementar** a verificação (bootstrap do app + `/health` dos três serviços + consulta de latência), gravando JSON com horário, versão e tempos.
- [ ] **Passo 3: rodar contra o host real** e guardar a prova.
- [ ] **Passo 4: agendar** a verificação por timer de sistema (modelo em `deploy/systemd/`) e documentar no runbook §4.
- [ ] **Passo 5: commit** — `test(045): verificar saúde da homologação a partir de outro host`.

### Tarefa 9: Backup conjunto de banco e arquivos, restauração isolada e RTO/RPO observados

**Arquivos:**
- Criar: `scripts/recovery-drill-remote.py`, `docs/etapas/045-recuperacao-fora-do-host.md`, `docs/etapas/045-prova-recuperacao-fora-do-host.json`
- Modificar: `scripts/backup-bundle.py` (incluir os três volumes de mídia), `docs/runbook.md` §5

**Interfaces:** o pacote passa a ser `{dump do banco, imagens, gravações, replay, manifesto SHA-256}`; o ensaio devolve `{rpoSegundos, rtoSegundos, arquivosConferidos, divergencias}`.

- [ ] **Passo 1: escrever o teste que falha** — adulterar um byte do manifesto e exigir que o restore recuse com divergência nomeada.
- [ ] **Passo 2: estender o empacotamento** para incluir os bytes de mídia e o manifesto conjunto.
- [ ] **Passo 3: ensaiar com escritores pausados** — parar app/workers, fechar o WAL, empacotar, religar; registrar o intervalo de escrita perdida (RPO observado).
- [ ] **Passo 4: restaurar em ambiente limpo** (outro diretório/host), subir a stack a partir do pacote e medir até o primeiro bootstrap 200 (RTO observado).
- [ ] **Passo 5: conferir integridade** — contagem de linhas por tabela, hashes das fotos e do replay, e uma jornada de leitura autenticada.
- [ ] **Passo 6: registrar** os números **como observados, sem declarar meta institucional**, e commitar.

### Tarefa 10: Falhas induzidas com observador externo

**Arquivos:**
- Criar: `scripts/staging-fault-matrix.py`, `docs/etapas/045-matriz-de-falhas.md`, `docs/etapas/045-prova-matriz-de-falhas.json`
- Modificar: `package.json` (`test:staging:fault-matrix`)

Cenários obrigatórios, cada um com carga ativa de votação e leitura pública: queda do Redis (fanout), queda do PostgreSQL, morte do worker de realtime, morte do worker de e-mail, perda de rede entre app e banco, reinício do host inteiro.

- [ ] **Passo 1: escrever a matriz** com, por cenário, o que deve acontecer (fato não se perde, outbox drena, cliente recompõe) e o que invalida o ensaio.
- [ ] **Passo 2: implementar** o roteiro reutilizando `staging-watch-fault.py` e `staging-mixed-load.py`, com o observador rodando **fora** do host.
- [ ] **Passo 3: executar** e exigir falha do script em qualquer divergência (evento perdido, voto duplicado, quadro do telão inconsistente).
- [ ] **Passo 4: registrar** prova e limites; commit.

---

# Trilha C — Acessibilidade e carga do plenário (etapas 048–049)

Independente da Câmara; fecha o item 1 da lista de próximas entregas do plano de 13/10.

### Tarefa 11: Auditoria de acessibilidade estendida

**Arquivos:**
- Criar: `scripts/staging-a11y-audit.mjs`, `docs/etapas/045-acessibilidade-votacao-presenca.md`
- Modificar: `package.json` (`test:staging:a11y`), `.github/workflows/ci.yml`

Hoje a auditoria cobre entrada, painel e telão. Estender para: **presença** (check-in e quórum), **votação** (aberta, com parcial oculto e encerrada), **telão em viewport de TV** (1920×1080 e 3840×2160) e **app do parlamentar em viewport móvel** (390×844).

- [ ] **Passo 1: escrever o gate** — zero violações `critical`/`serious` do axe por tela; violações `moderate` entram no documento com justificativa.
- [ ] **Passo 2: resolver o browser** — usar `executablePath` do Chromium do sistema quando os browsers do Playwright não estiverem baixados (foi o caso nesta máquina); falhar com mensagem clara se nenhum existir.
- [ ] **Passo 3: rodar, corrigir o que aparecer** (contraste, rótulo, ordem de foco) e repetir até o gate passar.
- [ ] **Passo 4: navegação por teclado** — percorrer check-in → abrir votação → votar → encerrar só com teclado e registrar a sequência de foco.
- [ ] **Passo 5: CI e commit**; manter explícito que leitor de tela humano e TV física continuam na fase 053.

### Tarefa 12: Carga concorrente de jornada, telão e portal

**Arquivos:**
- Criar: `scripts/staging-plenary-load.py`, `docs/etapas/045-carga-jornada-telao.md`, `docs/etapas/045-prova-carga-jornada-telao.json`
- Modificar: `package.json` (`test:staging:plenary-load`)

**Interfaces:** mede `{atrasoEventoP50, atrasoEventoP95, atrasoQuadroCongelado, errosHttp, eventosPerdidos}` com votação, leitura pública e dois nós de realtime ao mesmo tempo.

- [ ] **Passo 1: definir o perfil** — 13 parlamentares votando, 2 telões conectados, N leitores do portal, comandos de telão (congelar/liberar/trocar perfil) durante a votação.
- [ ] **Passo 2: escrever o teste que falha** — injetar atraso artificial e exigir que o script acuse `eventosPerdidos > 0`.
- [ ] **Passo 3: implementar e executar** contra a stack da Trilha B.
- [ ] **Passo 4: provar o quadro congelado sob concorrência** — congelar durante votação ativa e conferir que o SHA-256 público não muda enquanto o estado interno avança.
- [ ] **Passo 5: registrar** números observados e commit.

---

# Trilha D — Pacote de validação institucional (etapas 046–049 e 051)

Código já existe; falta a conferência humana. Estas entregas são **documentos de aceite**, não software — não têm teste automatizado e não devem ser declaradas concluídas por nenhum ensaio local.

| Entrega | Arquivo | Conteúdo | Quem assina |
|---|---|---|---|
| Matriz regimental | `docs/aceite/046-matriz-regimental.md` | Tipos de sessão, quórum por ato, maioria por tipo de matéria, desempate da Presidência, impedimentos, suplência | Secretaria legislativa + Presidência |
| Composição oficial | `docs/aceite/046-composicao-legislatura.md` | Legislatura, mandatos, licenças, partidos, Mesa, comissões | Secretaria legislativa |
| Casos de presença e votação | `docs/aceite/048-049-casos.md` | 10 a 15 casos reais anonimizados com resultado esperado, para conferência humana contra a apuração do sistema | Mesa |
| Convocação e ciência | `docs/aceite/047-canal-convocacao.md` | Canal, prazos regimentais, forma do comprovante de entrega e de ciência | Secretaria legislativa |
| Ata e publicação | `docs/aceite/051-ata-publicacao.md` | Formato, assinaturas, prazo de retificação, retenção, o que vai ao portal | Jurídico + Secretaria |

- [ ] **Passo 1:** gerar os cinco formulários a partir do que o código já exige (campos de `official-configuration`, `voting-policy`, `session-notice`), de modo que a Câmara preencha escolhendo, não redigindo.
- [ ] **Passo 2:** enviar, acompanhar e registrar as respostas **sem** cadastrar nada enquanto não houver assinatura.
- [ ] **Passo 3:** depois de aprovada a matriz, implementar os ajustes identificados como tarefas novas desta mesma trilha, cada uma com teste de caso regimental.
- [ ] **Passo 4:** só então cadastrar a configuração oficial de Mucuri e rodar `bun run pilot:preflight` até `automaticReady: true`.

---

# Trilha E — Piloto de Mucuri (etapa 053)

Entra **depois** de A, B, C e D. Pré-requisitos verificáveis: `pilot:preflight` verde, homologação fora do host com recuperação medida, pacote institucional assinado, canal de transmissão disponível.

- [ ] Sessão fictícia longa com equipe real, TVs e leitor de tela — registrar incidentes, não só sucessos.
- [ ] Sessões assistidas, com conferência humana independente de apuração e ata.
- [ ] Transmissão: primeiro canal institucional em sessão privada, observador externo, falha/retorno, gravação e replay conferidos.
- [ ] Aceites separados: legislativo, técnico e audiovisual, cada um em `docs/aceite/053-*.md`.
- [ ] Voto secreto e votação offline permanecem indisponíveis e isso consta do termo de aceite.

---

# Trilha F — Voto secreto (etapa 050) · condicional

Só começa se a Câmara exigir a modalidade. Hoje `Vote.value` guarda a escolha associada ao parlamentar e a modalidade está bloqueada em código para sessão oficial.

- [ ] Desenho que separe **elegibilidade** de **escolha** (urna com cédula anônima + prova de participação), mantendo reconta e auditoria.
- [ ] Revisão independente do desenho **antes** de qualquer implementação.
- [ ] Migração que não quebre recibos nem a cadeia de hash existente.
- [ ] Enquanto não houver as três coisas, manter o bloqueio e a limitação declarada no README.

---

# Trilha G — Integrações edocBR (etapas 054–056) · final

Decisão do projeto: só depois do piloto aceito. Ordem: leitura do Nextcloud → leitura do Alfresco → saída autorizada por outbox com reconciliação e reversão. Nenhum adaptador existe hoje; o contrato está em `docs/integracoes/arquitetura-edocbr.md`.

---

## Como acompanhar

Uma tarefa está fechada quando tem: código no `main`, gate no CI (quando houver comando), documento de etapa com data e limites, `PENDENCIAS-PRIORIZADAS.md` atualizado e — nas trilhas D e E — assinatura do responsável institucional. Nenhum ensaio local fecha pendência institucional, e nenhum documento fecha pendência técnica.

**Sequência recomendada:** Trilha A inteira (1–6, dias), depois C (11–12) em paralelo com a liberação do host da Trilha B (7–10), D começando agora pelo envio dos formulários, E quando A–D estiverem fechadas.
