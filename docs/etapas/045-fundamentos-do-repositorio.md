# Etapa 045 — Fundamentos do repositório (trilha A do plano de continuidade)

**Data:** 20/10/2026 · **Estado:** incremento técnico local concluído; dois passos destrutivos pendentes de autorização.

Fecha as seis tarefas da trilha A de [`PLANO-CONTINUIDADE-2026-10-20.md`](../PLANO-CONTINUIDADE-2026-10-20.md),
que traduzem os cinco achados da análise de 20/10/2026 em entregas testáveis.
Nada aqui toca módulo entregue, dado oficial ou a modalidade de voto secreto.

## O que mudou

| Achado | Entrega | Gate |
|---|---|---|
| Teste executado direto podia escrever na base de desenvolvimento | Guarda carregada como preload da suíte (`bunfig.toml` → `tests/guard-dev-database.ts`) e limpeza dos tenants sintéticos (`scripts/clean-test-tenants.ts`) | `bun test tests/database-guard.test.ts` · `bun run test:clean:test-tenants` |
| Projeto sem contrato para a próxima sessão | `CLAUDE.md` na raiz com stack, comandos conferidos, deploy e regras | — |
| Sem Caddy o tempo real nunca conectava e a falha era invisível | `src/lib/realtime-endpoint.ts` resolve o endereço; vigia de 15 s e rótulo próprio na topbar | `bun test tests/realtime-endpoint.test.ts` |
| Tenant padrão vazio produzia entrada sem saída | `actorsEmptyReason` no bootstrap e aviso no gate de acesso | `bun run test:bootstrap:empty-tenant` |
| Quatro perfis de demonstração sem senha | Seed dá senha a todo usuário sem hash | `bun run test:seed:demo-logins` |
| `db/` sem regra de descarte | `scripts/prune-local-backups.py` com simulação por padrão e retenção documentada no runbook §5.1 | `python3 -I tests/test-prune-local-backups.py` |

Os seis gates entraram no job `application` de `.github/workflows/ci.yml`.

## Verificações com resultado

Em 20/10/2026, nesta máquina:

- `bun run lint` e `bun run typecheck` — sem saída (limpos).
- `bun run build` — `✓ Compiled successfully in 9.8s`; `.next/standalone/server.js` gravado.
- `bun test tests/database-guard.test.ts tests/realtime-endpoint.test.ts` — 14/14.
- `bun run test:clean:test-tenants` — 2/2 · `bun run test:bootstrap:empty-tenant` — 3/3 · `bun run test:seed:demo-logins` — 3/3 · `bun run test:security` — 3/3.
- `python3 -I tests/test-prune-local-backups.py` — passou.
- Guarda contra o caso real: `DATABASE_URL="file:../db/custom.db" bun test tests/attendance-commands.test.ts` falha nomeando o caminho e o escape, e a contagem de `Tenant` fica inalterada (18 → 18).
- Tempo real no app real, as duas pontas: com `NEXT_PUBLIC_REALTIME_URL=http://localhost:3003` e sem Caddy a topbar vai a "Tempo real" em 1 s e o serviço registra `cliente inscrito`; sem a variável e sem Caddy o rótulo vira "Tempo real indisponível — verifique o gateway ou `NEXT_PUBLIC_REALTIME_URL`" em ~16 s.
- Aviso de Câmara sem usuários visível na tela com `DEFAULT_TENANT_SLUG=camara-mucuri-ba`, com os dois perfis de plataforma ainda listados.

Números observados, sem meta institucional declarada.

## Correções do próprio plano

- O achado 1 descrevia `bun test` lendo o `.env.local` e escrevendo em `db/custom.db`. Não se reproduz: `bun test` roda com `NODE_ENV=test` e, pela convenção dotenv, não carrega `.env.local` — o Prisma falha com `Environment variable not found: DATABASE_URL`. A exposição real é `DATABASE_URL` exportada no shell (ou `--env-file`), que é como os 15 tenants sintéticos entraram. A guarda cobre os dois caminhos.
- O `.env.local` desta instalação usa caminho relativo ao diretório `prisma/` (`file:../db/custom.db`), não `file:./db/custom.db`. A guarda resolve o relativo contra `prisma/` **e** contra a raiz.
- A lista de perfis de demonstração está no gate de acesso (`src/app/page.tsx`), não em `login-form.tsx`.
- Com Mucuri, `actors` nunca vem vazio (traz os dois atores de plataforma). O motivo olha os usuários próprios do tenant, senão o aviso nunca apareceria no caso que motivou a tarefa.

## Correções após revisão de contexto novo (21/10/2026)

A revisão do branch inteiro, em contexto novo, achou dois defeitos críticos no que esta etapa entregou. Ambos corrigidos com teste que falhou primeiro:

- **O `--apply` da limpeza nunca executava.** `backup-bundle.py create` exige `--sqlite-source`, `--images-root` e `--public-root`, e o roteiro chamava sem nenhum deles: o backup falhava sempre e a remoção nunca acontecia. O caminho de aplicação era código morto, e o teste não pegava porque exercitava a remoção direto, sem passar pelo backup.
- **URL que não designa arquivo caía em `db/custom.db` em silêncio.** Rodar com a URL de homologação exportada planejava contra PostgreSQL e apagava na base de desenvolvimento, sem backup. Agora falha alto pedindo `--database`.
- **Tudo fora de três slugs fixos era descartável**, então Câmara ativada por onboarding seria apagada sem ninguém editar a lista. O padrão passou a ser o sufixo de UUID — evidência de origem sintética, que cobre os 15 tenants da base — e slug desconhecido só entra com `--incluir-desconhecidos`.
- **A guarda de banco estava inerte em `bun test <arquivo>`**, a invocação que ela existe para cobrir, porque só olhava a variável do ambiente. Passou a conferir também a URL do `.env.local`. Como efeito, toda invocação de `bun test` declara banco descartável; `bun run test:unit` é o comando dos testes unitários.
- **Variável de tempo real inválida derrubava a tela.** `realtimeEndpoint` lança por desenho, mas era chamada dentro do efeito do hook: erro de configuração desmontava a árvore React. O cliente passou a usar a versão tolerante, que registra o erro e cai no gateway; o vigia faz o diagnóstico. Provado em build de produção com valor inválido.
- Também corrigidos: vigia não rearmado na queda do serviço, rótulo de 73 caracteres quebrando a topbar, `.env.example` com valor que quebra instalação com gateway, `--keep 0` da poda apagando todo backup, e a auditoria de acessibilidade tendo a porta do servidor de desenvolvimento como alvo padrão.

## Limpeza aplicada (21/10/2026)

`bun run db:clean:test-tenants --apply` foi executado com autorização explícita: 15 tenants sintéticos e 185 linhas removidos; sobraram os três reais (`camara-mucuri-ba`, `camara-serra-azul`, `camara-vila-nova`). `pragma foreign_key_check` sem saída e `pragma integrity_check` em `ok`. Backup verificável em `db/bundle-clean-test-tenants-20261021T140704Z` (7 arquivos, manifesto SHA-256 conferido), preservando o estado anterior de 18 tenants.

## Limites e pendências

- **Este projeto não tem VPS** (decisão de 21/10/2026): o desenvolvimento segue local e a seção Deploy do `CLAUDE.md` registra isso. A homologação em contêiner roda na própria máquina de desenvolvimento e **não** substitui host separado.
- **A retenção de backups segue não aplicada.** A simulação com `--keep 5 --keep-pattern etapa-` removeria 19 arquivos (19,1 MB), mas 20 das 29 cópias são nomeadas em algum documento de etapa: antes de aplicar, liste os rótulos citados e proteja cada um por `--keep-pattern` (runbook §5.1).
- Nada aqui substitui prova fora do host (trilha B), carga concorrente (tarefa 12) ou aceite institucional (trilhas D e E).
