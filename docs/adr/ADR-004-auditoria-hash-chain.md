# ADR-004 — Auditoria append-only com encadeamento de hash

## Status
Aceito

## Contexto
O prompt exige trilha de auditoria append-only resistente a adulteração, com ator, tenant,
IP, horário, valores anteriores/posteriores e justificativa quando aplicável.

## Decisão
1. Tabela `AuditEvent` é append-only (nenhuma rota atualiza/exclui registros).
2. Encadeamento: cada evento grava `prevHash` (hash do evento anterior do tenant) e
   `chainHash = sha256(prevHash + JSON(canônico do evento))`, permitindo verificação de
   integridade da cadeia (`GET /api/v1/audit?verify=true`).
3. Todo comando sensível (transições de sessão/votação, voto, presença, discurso,
   white-label, anulação com justificativa) registra: ator (nome+papel), tenant,
   agregado, `beforeValue`/`afterValue` (JSON), justificativa quando exigida,
   `correlationId` (UUID por requisição) e IP (via headers do gateway).
4. Votos secretos NÃO gravam valor individual na auditoria (apenas a ação `vote.cast`
   sem o valor, preservando sigilo).

## Consequências
- Verificação de cadeia é O(n) por tenant; suficiente para piloto (linhas na ordem de
  milhares). Produção deve particionar por lote/período conforme prompt.
