# Task 29-a — Fase 18 (Onda 4): Votação avançada — opções customizadas, declaração de voto e recibos verificáveis

Agente: full-stack-developer (subagente) · Data: 2026-08-31 · Base: seed prístino ao final

## Contexto da retomada

Os arquivos sob ownership já estavam implementados por uma execução anterior interrompida
desta mesma task (sem registro em worklog/agent-ctx — mesma situação reportada por 28-b).
Auditei cada arquivo contra o briefing e o ROADMAP §11.2, re-executei a verificação real
completa do zero, apliquei UM polimento (frase-resumo multi-opção redundante) e registrei tudo.

## Ownership auditado (estado final)

| Arquivo | Estado | Observações |
|---|---|---|
| `src/lib/server/voting-service.ts` | completo + polish | assertVoteValueAllowed (422 campo), computeVotingResultAdvanced (multi-opção, empate/sem_quorum), customResultSummaryPhrase (polish: sem repetição da vencedora), countsPhraseForNotify, issueVoteReceipts (upsert idempotente + auditoria voting.receipts_issued na mesma tx) |
| `src/app/api/v1/sessions/[id]/votings/route.ts` | completo | Zod options 1–5 (key `[a-z0-9_]{2,40}`, label 1–60, sem dup); createMany order 0..n; options públicas no outbox voting.created |
| `src/app/api/v1/votings/[id]/votes/route.ts` | completo | value string → validado no serviço contra VotingOptions |
| `src/app/api/v1/votings/[id]/receipts/route.ts` | NOVO | RBAC OR (audit.read ∨ voting.write) via PERMISSIONS; recompute HMAC por voto; 409 se não fechada; mismatch inclui voto sem recibo e recibo órfão; join manual com Parliamentarian (schema sem relation) |
| `src/app/api/v1/me/vote/route.ts` | completo | receiptPending: true apenas nominal; secreto não ecoa valor |
| `src/app/api/v1/me/receipts/route.ts` | NOVO | self.vote + requireMeParliamentarian; join Voting (question/mode/closedAt); take 60 desc |
| `src/lib/server/serializers.ts` | completo | toVotingView inclui options ordenadas (opcional no include); buildSessionDetail já inclui options |
| `src/app/api/v1/votings/[id]/transition/route.ts` | completo | close com computeVotingResultAdvanced; simbólico+custom exige customCounts (422 faltando/desconhecida); issueVoteReceipts na MESMA tx; resultSummary com frase multi-opção |
| `src/app/api/v1/me/context/route.ts` | editado (aditivo) | activeVoting.voting.options |
| `src/app/api/v1/public/live/route.ts` | editado (aditivo) | options em currentVoting/lastResults (rótulos públicos) |
| `src/lib/api-client.ts` | editado (aditivo) | createVoting options, transitionVoting customCounts, votingReceipts, meReceipts, MyVoteReceiptRow, MeContextViewExt, PublicLiveViewExt |
| `src/modules/plenary/voting-tab.tsx` | completo | ValueBadge (rótulo custom), grade com botões por opção, resultado com CountCards por rótulo + "Não registraram", ReceiptsPanel (badge verde/vermelho, lista mono, Reverificar, nota secreto), CloseSymbolicDialog com customCounts, histórico com badge "opções regimentais" |
| `src/modules/plenary/agenda-tab.tsx` | completo | dialog "Configurar votação": fieldset "Opções de resposta" + Switch "Usar opções regimentais customizadas", 1–5 pares key/label (slugify automático editável, adicionar/remover, validação cliente espelhando servidor) |
| `src/modules/pwa/index.tsx` | completo | botões por rótulo (tons alternados), hint "Recibo verificável será emitido no encerramento" (nominal), toast com receiptPending, aba "Recibos" no histórico (pergunta+data+código mono), invalidação me-receipts em voting.state_changed |
| `src/modules/display/profiles.tsx` + `index.tsx` | completo | rótulos legíveis nas votações em curso (chips) e no resultado (BigCount por rótulo + VoteTag com label — nunca só cor) |

## Decisões

- RBAC OR em receipts: não há helper no projeto — verificado direto contra PERMISSIONS (rbac.ts intocado).
- Recibos em `simbolico` apenas com votos individuais (registeredCount > 0) — simbólica pura não gera recibo (issueVoteReceipts retorna 0 com votes.length === 0); a UI reflete com estado vazio explicativo.
- `receiptPending` apenas em nominal (secreto emite recibo de PARTICIPAÇÃO — placeholder `__SIGILO__`; o aviso de recibo do PWA é específico de nominal).
- Ordem determinística no desempate multi-opção: contagem desc → order da opção asc (nunca depende de empate de inserção).
- Join manual VoteReceipt×Parliamentarian (schema Task 27 sem relation — não tocado).
- Polish aplicado nesta sessão: `customResultSummaryPhrase` não repete mais a opção vencedora na enumeração ("demais: …") e ganhou guarda para options vazio + tiebreak por label.

## Verificação real (curl, status reais — atores Marcos/Carla/Helena)

1. s2 detail → votação READY com options [aprovar_envio, arquivar, adiar] (labels+order) ✅
2. Voto `sim` → **422** VALIDATION_ERROR campo value ("Chave de opção inexistente… chaves válidas: aprovar_envio, arquivar, adiar"); voto `adiar` → **200** ✅
3. POST votação com 3 options → **201** com options order 0..2; key inválida → **422** (options.0.key); label vazio → **422** (options.0.label); 6 opções → **422** (max 5); keys duplicadas → **422** ✅
4. Fechamento nominal custom (7 votos: 4/2/1, 9 presentes) → **200** aprovado, resultCounts.custom={aprovar_envio:4, arquivar:2, adiar:1}, sim/nao/abstencoes=0, naoRegistraram=2; GET receipts → **200** ok=true recomputed=7 mismatch=0 ✅
5. GET /me/receipts (Carla) → **200** com recibo da v1 (seed) + votações da sessão; Marcos → **403** ✅
6. GET receipts v1 (REQ 120, seed) → **200** ok=true, 11 recibos, 0 divergências (determinização seed↔serviço) ✅
7. Tamper (bun -e update receiptCode='TAMPERED0001') → GET receipts → **200** ok=**false**, mismatchCount=**1** (recibo tampado listado + divergência apontada); revertido via reseed ✅
8. Extras: /me/vote nominal → receiptPending=true; secreto → value null + receipts com placeholder batendo (ok=true, 2/0); simbólico custom: close sem customCounts → **422**, chave desconhecida → **422**, válido → aprovado (6/2/1); unanimidade 2 opções → rejeitado; empate maioria_simples → empate; RBAC receipts: parliamentarian **403** / auditor **200**; 409 em votação não fechada; resultSummary item pauta = "Aprovado — opção mais votada: “Aprovar” (3 votos); demais: 1 voto “Rejeitar”."; auditoria voting.receipts_issued ×7 (incl. seed) visível ao auditor.
9. Idempotência da emissão: re-execução de issueVoteReceipts com mesmo closedAt → 7 antes/depois (upsert, sem duplicar/falhar) ✅
10. `bun run lint` → 0 erros/0 warnings; `bunx tsc --noEmit` → apenas erros pré-existentes (NextRequest×Request em ~todas as rotas + PlatformOverviewView/TenantConsoleView/PlanView/MigrationRunView ausentes do import em api-client.ts — todos já presentes no HEAD, fora do escopo); dev.log sem erros de runtime (apenas EADDRINUSE histórico e 2 SyntaxError de JSON malformado dos MEUS payloads de teste).
11. Base revertida ao seed prístino (verificação 1/5/6 re-checadas na base limpa) + smoke home 200.

## ⚠️ Pendência para o main (nova, bloqueia `bun prisma/seed.ts` em dias 29–31)

`prisma/seed.ts` FASE 10 usa `setMonth()` sem clamp de dia: em **2026-08-31**,
`twoMonthsAgo` (ago.31 → jun.31) rola para **1º de julho** e colide com `monthAgo`
(jul.31) no unique `(tenantId, periodYear, periodMonth)` → **P2003/P2002 na fatura nº 2**
(mesma família de bug de idempotência reportado por 28-a/28-b, agora dependente de data).
Correção sugerida (ownership main): subtrair mês com clamp de dia, ex.:
`new Date(y, m - n, Math.min(day, diasDoMês))`.
Workaround usado nesta task: cópia temporária `seed-tmp.ts` na raiz (fora de prisma/) com
o clamp — executada 2× (início e fim), **removida** ao final; `prisma/` intocado.

## Limitações

- tsc estrito mantém erros pré-existentes documentados acima (portão oficial do projeto é `bun run lint`).
- `resultSummary` é persistido no fechamento — votações fechadas antes do polish mantêm a frase antiga (comportamento por design, frases são imutáveis pós-fato).
- A rota do operador ecoa `value` do voto no POST (comportamento pré-existente da Fase 7 — a UI nunca exibe em secreto e a resposta pública/auditoria nunca vazam).
- Corpo JSON malformado em POSTs gera 500 INTERNAL_ERROR (comportamento pré-existente do apiHandler; fora do ownership desta task).
