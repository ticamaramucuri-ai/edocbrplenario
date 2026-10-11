# Task 33-b — Pacote de documentação v0.12.0

Subagente docs | Sessão: produção e verificação do pacote documental da v0.12.0
(módulo "Planejamento e Roadmap" + Onda 5 planejada).

## Ownership exclusivo (documentação + 1 arquivo de código autorizado)

| Arquivo | Estado | Conteúdo |
|---|---|---|
| `docs/CHANGELOG.md` | editado | Entrada `[0.12.0] — Planejamento da Onda 5 e módulo "Planejamento e Roadmap"` no TOPO com seções **Adicionado** (módulo 24 com 5 abas; rotas GET/PATCH com RBAC/erros esperados; RoadmapPhase/RoadmapTask nível plataforma; roadmapApi/tipos Roadmap*/roadmap-content.ts; seed 4 fases/34 tasks), **Planejado** (Onda 5 — Fases 21–24 resumidas; ADRs 022–025 planejados; Onda 6 prévia §13) e **Documentação** (ROADMAP §12/§13/§8 + pacote desta entrada). `[0.11.0]` intacta |
| `docs/user-manual.md` | editado | Índice com nova seção **10. Planejamento e Roadmap (v0.12.0)** (fluxo/FAQ renumerados 11/12); tabela de módulos com **24** (Planejamento e Roadmap no grupo Administração); contagens 23→24 (⌘K e FAQ); Central de Ajuda com **19 FAQs** e timeline 0.1.0→0.12.0; seção nova (~5 parágrafos + "Como usar por papel" + "O que o progresso significa" + roteiro de demonstração) alinhada à UI final da 33-a; **3 FAQs novas** (acompanhar o que vem, quem marca tasks, onde ver a documentação) |
| `src/lib/server/help-content.ts` | editado (único arquivo de código) | Header "Fases 0–20 entregues · Onda 5 planejada (v0.12.0)"; changelog interno com **0.12.0 no topo** (4 destaques); **1 passo novo em cada um dos 7 guias** citando o módulo (tenant_admin "Acompanhe o roadmap do produto"; platform_owner "Gerencie o progresso da Onda 5"; demais com leitura) + chip `roadmap` nos `modules`; FAQ ⌘K 23→24 módulos; 3 FAQs novas (19 total); `ABOUT.version '0.12.0'`; descrições do ROADMAP (§12/§13 + consultável no produto) e Changelog (0.1.0 → 0.12.0) |
| `README.md` | editado | Título/parágrafo de abertura **v0.12.0 (24 módulos)** com destaque "Planejamento e Roadmap — o plano do produto dentro do produto" (+ Onda 5 planejada e Onda 6 prévia); bullet novo em Destaques; índice de documentação (ROADMAP §12/§13, manual 24 módulos, ~76 grupos de rotas); **ADRs 001–021 entregues + 022–025 planejados** (4 linhas novas na tabela); mapa de módulos (24) + nota de que Integrações & API/Crescimento/scheduler :3005 são PLANEJADOS (TO-BE v5) |
| `docs/runbook.md` | editado | §3 com **RoadmapPhase/RoadmapTask no seed** (4 fases F21–F24, 34 tasks, 0/34) + **nota operacional** do módulo (sem dependência extra; PATCH exige platform_owner — 403 esperado para demais; re-seed zera o progresso; registro na própria linha fora da cadeia de auditoria de tenant) |
| `docs/test-report.md` | editado | Seção **"v0.12.0 — módulo Planejamento e Roadmap"** com evidências reais de curl (ver abaixo) + smoke do help 0.12.0 + lint |
| `docs/ROADMAP.md` | editado (3 ajustes cirúrgicos) | Cabeçalho corrigido (24 módulos, ~76 grupos, 24º módulo v0.12.0 — divergência: dizia v0.11.0/23 módulos); §12.5 Tasks 33-a e 33-b marcadas **✅ subagente** (Task 32 já ✅ main). §12/§13 NÃO reescritos |

NÃO editados (regra da task): `src/modules/**`, `src/app/**`, `src/lib/**` (exceto
`help-content.ts`), `prisma/**`, `src/components/**`.

## Evidências reais coletadas (curl, dev server :3000, ids do seed)

1. `GET /api/v1/roadmap` (Ana, tenant_admin) → **200**: meta {24 módulos, ~76 grupos,
   21 ADRs, mini-services 3003/3004/gateway}; delivered Ondas 1–4; phases **F21 0/8 ·
   F22 0/9 · F23 0/8 · F24 0/9 = 34 tasks** (todas pendentes); menuV5 6 grupos; docs
   **16** (12 entregues + 4 planejados); wave6 F25–F28; execution 10 tasks.
2. `GET /api/v1/roadmap` (owner sem tenant) → **200**; **sem ator → 401**
   `UNAUTHENTICATED` (Problem Details).
3. `PATCH /api/v1/roadmap/tasks/:id` (Ana) → **403** `FORBIDDEN_ROLE` ("Papel
   \"tenant_admin\" não pode executar \"platform.manage\". Papéis permitidos:
   platform_owner.").
4. `PATCH` (owner) → **200** com `status: em_andamento`, `updatedByName: "Suporte
   Legis SaaS"`, `updatedAt` preenchidos na própria linha.
5. `PATCH` status `"feita"` → **422** `VALIDATION_ERROR` (field status); id
   inexistente → **404** `NOT_FOUND`; **revert para pendente → 200** (base 0/34).
6. `GET /api/v1/help` (Ana) → `about.version 0.12.0`, changelog[0] 0.12.0, 7 guias
   (passos 8/8/7/7/6/6/7 — todos com chip roadmap), **19 FAQs**, **29 documentos**.
7. `bun run lint` → **0 erros / 0 warnings**; home 200; dev.log sem erros de runtime.

## Verificações finais

- `bun run lint` EXIT=0 (após todas as edições de help-content.ts).
- Smoke obrigatório `curl -s -H "x-actor-id: cmth7zi9p000wqiquuc4cwf38"
  http://localhost:3000/api/v1/help` → version **0.12.0** confirmado.
- Contagem de documentos do ABOUT verificada: **29** (8 documentos nomeados + 21 ADRs
  entregues; ROADMAP já estava listado; ADRs 022–025 são PLANEJADOS e não entram —
  coerência mantida em 29, não 30).

## Divergências e observações

1. **ROADMAP.md cabeçalho desatualizado** pelo main (dizia "v0.11.0, 23 módulos, ~75
   grupos" no estado entregue) — corrigido para 24 módulos/~76 grupos com o 24º módulo
   da v0.12.0.
2. `RoadmapContent.meta.currentVersion` do GET /roadmap segue `"0.11.0"` com
   `plannedVersion "0.12.0"` (código da Task 32/33-a — fora do meu escopo): o módulo
   descreve o "estado entregue até 0.11.0" + o próprio release; vale revisar no
   fechamento da v0.12.0 (poderia ser current 0.12.0 / planned 0.13.0).
3. Ao marcar §12.5, a entrada de worklog da **33-a ainda não constava** no
   worklog.md/agent-ctx; a UI completa estava observável no código (5 abas — Visão
   geral, Onda 5 — Fases, Menus e páginas, Documentação, Onda 6 — com seletor de
   status para owner), lint 0 erros e GET /api/v1/roadmap 200 — marcada ✅ subagente
   com base nisso.
4. Documentação do manual/ajuda foi **re-alinhada à UI final da 33-a** durante a
   sessão (abas e "seletor de status" em vez da ciclagem por clique do stub).

## Limitações

- Evidências do pacote são de **API (curl)** — o E2E no navegador do módulo é registro
  da 33-a/main (declarado no test-report).
- ROADMAP §12/§13 intocados por regra (só 3 ajustes autorizados aplicados).
- test-report/CHANGELOG registram o comportamento "re-seed zera o progresso das
  tasks" como conhecido (a base demo representa o plano no estado inicial da Onda 5).
