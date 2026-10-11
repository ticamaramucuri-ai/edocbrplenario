# ADR-018 — Ciclo de vida da matéria: desfechos pós-aprovação e relacionamentos

**Status:** Aceito · **Data:** 2026-08-31 (Onda 4 / Fase 17) · **Contexto:** sandbox

## Contexto

O prompt mestre exige o material formalizado do ciclo pós-aprovação (§7.3: "Despachos,
pareceres, **emendas, substitutivos, vetos e sanções**" e "relacionamentos"). Até a v0.10.0 o
fluxo terminava em `aprovado|rejeitado`: não havia registro de sanção ou veto do Executivo,
nada apontava o prazo regimental de apreciação de um veto, e emendas/substitutivos eram apenas
andamentos de tramitação — sem vínculo estrutural consultável entre a matéria principal e a
peça que a altera, revoga, regulamenta ou substitui.

## Decisão

1. **Desfechos como fatos append-only** (`MatterOutcome`): `kind ∈ sancao|veto_total|
   veto_parcial`, `actorName` (quem promulgou/vetou — ex.: "Prefeito Municipal"), `date`,
   `notes?` e `dueAt?` (prazo de apreciação). Desfechos nunca são editados nem apagados —
   o histórico é a própria linha do tempo do ato.
2. **Transição `aprovado → sancionado|vetado` EXCLUSIVAMENTE via outcome** (`MatterStatus`
   ganha `sancionado | vetado`). `POST /api/v1/matters/:id/outcomes` executa UMA transação:
   cria o `MatterOutcome` + grava `Proceeding` (`action sanco|veto` com o próximo `seq`,
   `fromStatus/toStatus`) + atualiza o status da matéria + grava auditoria `matter.outcome`
   com before/after. Nenhuma outra via muda esses status: o dialog de andamento os trata
   como terminais, e não existe CRUD direto de situação.
3. **Regras de pré-condição na fronteira**: veto exige matéria `aprovado` + `notes`
   obrigatória (422 com field error); sanção exige `aprovado` OU `vetado` quando o último
   desfecho é `veto_parcial` (promulgação da parte não vetada); desfecho do MESMO kind do
   último registrado → 422 (duplicado). Sanção após veto parcial é um NOVO outcome — o
   histórico parcial permanece íntegro.
4. **Veto agenda a apreciação**: cria `LegislativeTask` "Apreciar veto total/parcial — {matéria}"
   (`kind prazo`, `assigneeName Plenário`) com `dueAt` informado ou **+15 dias às 19h**
   (padrão regimental), visível em Prazos e Tarefas e na Agenda Legislativa enquanto pendente.
5. **Relacionamentos estruturais** (`RelatedMatter`): `kind ∈ altera|revoga|regula|
   subsidiaria|emenda|substitutivo` + `notes?`. O par `(matterId, relatedMatterId)` é único
   no banco E validado explicitamente **em qualquer direção** (A→B bloqueia B→A, 422 com
   detail); auto-referência → 422; alvo de outro tenant → 404 (nunca 403 para não vazar
   existência entre tenants). A leitura (`GET /:id/related`) devolve as duas direções com
   `direction from|to` e a matéria da outra ponta (`MatterRef`), permitindo que a emenda
   enxergue a principal e vice-versa. Escrita/leitura: `matter.write` / qualquer ator do
   tenant; auditoria `matter.related` / `matter.related_removed` na transação.
6. **Desvinculação física no sandbox** (decisão documentada): `DELETE /:id/related
   ?relatedId=` remove a linha e audita `matter.related_removed` com o estado anterior
   (kind, direção, matéria da outra ponta). Em produção a remoção será uma **anulação
   auditada** (registro mantido com `removedAt`/justificativa), coerente com o append-only
   dos outcomes — no sandbox o DELETE físico mantém o modelo mínimo e a auditoria preserva
   o rastro do vínculo que existiu.

Transparência: `GET /api/v1/matters/:id` ganha `related[]` + `outcomes[]`;
`GET /api/v1/public/matters/:id` publica o desfecho mais recente (kind, autor, data, prazo) —
`related` permanece interno (decisão de escopo público).

## Alternativas consideradas

- **Desfecho como `Proceeding` com `action sanco|veto`**: o enum já previa as ações, mas o
  andamento não carrega autor do Executivo, prazo de apreciação nem valor de "fato externo
  assinado" — e dependeria de disciplina do chamador para criar a tarefa. Um fato dedicado
  (MatterOutcome) formaliza o ato e o sistema deriva andamento + tarefa + transição.
- **Mudança de status por PATCH da matéria (CRUD direto)**: rejeitado — quebraria o
  princípio consolidado desde a Fase 5 (situação muda SOMENTE via registro formal auditado)
  e perderia o before/after e o agendamento do prazo.
- **Relacionamentos como campo JSON na matéria**: sem integridade referencial, sem índice,
  sem leitura na direção inversa.
- **Par único em uma única direção** (A→B permitindo B→A como registro distinto): rejeitado
  — o relacionamento é conceitualmente simétrico na busca; duplicar direções criaria pares
  contraditórios. O par único é bidirecional por construção.

## Consequências

- (+) O ciclo legislativo fecha de ponta a ponta: aprovação → sanção/veto (com prazo
  regimental agendado) → promulgação após veto parcial, tudo rastreável na mesma linha do
  tempo (outcome + proceeding + auditoria).
- (+) Emendas/substitutivos deixam de ser texto solto: o vínculo estrutural aparece no
  dossiê de ambas as matérias e o portal público expõe o desfecho.
- (−) Ciclos de relacionamento (A→B→C→A) NÃO são validados — apenas o par duplicado direto
  é bloqueado (escopo da fase); desvinculação é física no sandbox.
- (→) Produção: anulação auditada de vínculo (sem DELETE), validação de ciclos, apreciação
  de veto como item de pauta regimental próprio e publicação do desfecho no diário oficial.
