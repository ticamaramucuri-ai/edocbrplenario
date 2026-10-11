# ADR-002 — Motor de sessões, votação e regras regimentais configuráveis

## Status
Aceito

## Contexto
O prompt proíbe inventar regras regimentais universais: quórum, maioria, alteração de voto
e tempos de discurso variam por Câmara/regimento.

## Decisão
1. **Máquina de estados explícita** para `Session`
   (`draft → scheduled → check_in → open → suspended ⇄ resumed → closed`, com `cancelled`),
   sem alteração direta de `status` por CRUD: toda transição passa pelo comando dedicado
   `POST /api/v1/sessions/:id/transition`, com validação de pré-condições (ex.: sessão só
   abre com presidente definido), versão otimista (`version`), evento de domínio no outbox
   e auditoria.
2. **Máquina de estados de votação** (`draft → ready → open ⇄ paused → closed`,
   `closed → annulled` apenas com justificativa) com bloqueio absoluto pós-fechamento.
3. **Idempotência de voto** por chave única `(votingId, parliamentarianId)` +
   `commandId` (chave única `(votingId, commandId)`); repetição do mesmo `commandId`
   retorna o estado atual sem duplicar; alteração de voto enquanto aberta é política do
   tenant (`settings.allowVoteChange`, padrão `true`) e gera auditoria `vote.changed`.
4. **Regras configuráveis por tenant** em `Tenant.settings` (JSON):
   `quorumMinimum` (padrão: metade dos membros ativos, arredondada para cima),
   `allowVoteChange`, `speechDefaultSeconds`, `soundAlerts`, `hidePartialByDefault`.
5. **Cálculo determinístico de resultado**: `maioria_simples` (sim > não),
   `maioria_absoluta` (sim > total de membros/2), `unanimidade`; sem quórum no fechamento
   → `sem_quorum`; empate → `empate` (desempate pela presidência permanece ação manual e
   auditada, não automática).
6. **Voto secreto**: valores individuais nunca expostos (nem na auditoria, nem no
   resultado, nem no telão); apenas agregados + prova de elegibilidade (quórum snapshot).
7. **Snapshots** de presença/quórum capturados na abertura e no fechamento da votação.

## Consequências
- Regras sensíveis ficam em configuração e os defaults documentados aqui e no seed.
- Voto nominal gera recibo (registro com `receivedAt`, `changedAt`, ator e dispositivo
  simulado pelo ator operador).
