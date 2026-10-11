# Task 28-a — full-stack-developer (subagente) — Fase 17: ciclo de vida da matéria

Contexto: subagente da Onda 4 do Legis SaaS (Next.js 16 App Router + TS estrito + Prisma/SQLite
+ Tailwind 4 + shadcn/ui + TanStack Query). Base compartilhada da Task 27 já aplicada
(schema RelatedMatter/MatterOutcome, contracts, RBAC matter.write, seed). Este registro
resume a execução desta task; o worklog oficial está em `/home/z/my-project/worklog.md`
(seção `Task ID: 28-a`).

## Rotas entregues (ownership exclusivo)

- `src/app/api/v1/matters/[id]/related/route.ts` — GET/POST/DELETE
- `src/app/api/v1/matters/[id]/outcomes/route.ts` — GET/POST
- `src/app/api/v1/matters/[id]/route.ts` — detalhe enriquecido (`related[]` + `outcomes[]`)
- `src/app/api/v1/public/matters/[id]/route.ts` — `outcome` (mais recente) no payload público
- `src/lib/server/serializers.ts` — `toMatterRef`, `matterRefLabel`, `toRelatedMatterView`
  (perspectiva/direção), `toMatterOutcomeView`, tipo `RelatedMatterWithEnds`
- `src/modules/matters/index.tsx` — badges Sancionada (emerald-800) / Vetada (red-800);
  filtro de status deriva de MATTER_STATUS_LABEL (já inclui os novos)
- `src/modules/matters/lifecycle-sections.tsx` — seções do drawer "Relacionamentos" e
  "Desfecho (sanção/veto)" com dialogs, AlertDialog, toasts, loading/erro/vazio, a11y
- Integração no drawer compartilhado: `src/modules/workflow/matter-drawer.tsx` importa
  `MatterLifecycleSections`; `src/modules/workflow/proceeding-dialog.tsx` marca
  sancionado/vetado como situações TERMINAIS (desfecho só via POST /outcomes)

## Regras de negócio implementadas

- Related: par único em QUALQUER direção (422 duplicado), auto-referência (422),
  alvo inexistente (404) / de outro tenant (403 FORBIDDEN_TENANT), auditoria
  `matter.related` / `matter.related_removed` na transação.
- Outcomes: sancao com status aprovado OU vetado+último=veto_parcial (promulgação da
  parte não vetada); vetos apenas com aprovado e justificativa OBRIGATÓRIA (422 campo
  `notes`); mesmo kind do último → 422 duplicado; veto cria LegislativeTask
  "Apreciar veto …" (prazo informado ou +15d às 19h, Plenário) + Proceeding
  (`sanco`/`veto`, próximo seq, fromStatus/toStatus); transição de status
  (sancionado/vetado) na MESMA transação; auditoria `matter.outcome` com before/after.

## Verificação real (curl, ator Ana Ribeiro tenant_admin)

1. GET /matters → 200, 27 matérias; PL 49/2026 `vetado`, PL 41/2026 `sancionado`.
2. GET /matters/<pl44> → `related` = [EM 12 (emenda, direction from)], `outcomes` = [];
   GET /matters/<em12>/related → mesma relação com direction `to`.
3. POST /matters/<pl43>/related subsidiaria → PL47 → **201**; duplicado direta e
   INVERSA → **422**; auto-referência → **422**; alvo de outro tenant → **403**;
   alvo inexistente → **404**; kind inválido → **422** (Zod).
4. POST veto_total sem notes em PL43 (incluida_pauta) → **422** (status); veto_parcial
   sem notes em matéria aprovada → **422** (campo notes).
5. POST sancao em PL47 (em_tramitacao) → **422**.
6. Fluxo completo: veto_parcial em matéria aprovada → **201** (status→vetado, task
   "Apreciar veto parcial — MO 1/2026" prazo 15d, proceeding seq 1 `veto`
   aprovado→vetado); veto_parcial repetido → **422** duplicado; sancao após veto
   parcial → **201** (status→sancionado); veto sobre sancionada → **422**.
   Auditoria conferida (`matter.related`, `matter.related_removed`, `matter.outcome`).
7. GET /public/matters/<pl49>?tenant=camara-vila-nova → inclui `outcome` veto_total
   com dueAt; PL 44 sem desfecho → `outcome: null`; `related` NÃO vaza no público.
8. DELETE /matters/<pl43>/related?relatedId=… → **200**; re-DELETE → **404**.
9. RBAC: leitura OK para auditor (200); escrita 403 para parliamentarian
   (related e outcomes).

Lint `bun run lint` 0 erros/0 warnings; dev.log sem erros de runtime; base revertida ao
seed prístino no final.

## ⚠️ Pendência para o main (ownership do seed)

`bun prisma/seed.ts` NÃO é idempotente com a base da Onda 4: a limpeza não remove
`SupportImpersonation` (bloqueia `user.deleteMany` — FK sem cascade) nem
`CitizenSubscription`/`ExportJob` (bloqueiam `tenant.deleteMany`). O reseed falha com
P2003 quando essas tabelas têm linhas da execução anterior. Workaround usado aqui:
script one-off de pre-clean dessas tabelas antes do seed. Correção sugerida no seed
(adicionar antes de `user.deleteMany` / `tenant.deleteMany`):

```ts
await db.supportImpersonation.deleteMany()
// … e antes de tenant.deleteMany():
await db.citizenSubscription.deleteMany()
await db.exportJob.deleteMany()
await db.platformAlert.deleteMany()
```

Nota: o subagente 28-b roda em paralelo e também escreve na mesma base (dados de
teste de assinaturas/apreciação de veto foram removidos pelo reseed final desta task).
