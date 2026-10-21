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

## Limites e pendências

- **Seção Deploy do `CLAUDE.md` com campos `A DEFINIR`.** Host, usuário, pasta e comando de reinício da VPS não foram informados; nenhum deploy foi executado nem documentado.
- **Dois passos destrutivos não aplicados**, por exigirem autorização explícita: `bun run db:clean:test-tenants --apply` (simulação confere: 15 tenants sintéticos, 171 linhas, os três reais intactos) e `bun run db:backup:prune -- --apply` (simulação com `--keep 5 --keep-pattern etapa-`: 19 arquivos, 19,1 MB). Ambos gravam backup antes e falham fechado.
- A retenção de backups pede, antes de aplicar, listar os rótulos citados em documento e protegê-los por `--keep-pattern` — 20 das 29 cópias são nomeadas em algum documento de etapa.
- Nada aqui substitui prova fora do host (trilha B), carga e acessibilidade estendida (trilha C) ou aceite institucional (trilhas D e E).
