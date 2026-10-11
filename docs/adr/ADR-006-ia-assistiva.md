# ADR-006 — IA assistiva com rastreabilidade total e revisão humana obrigatória

**Status:** Aceito · **Data:** Fase 7 · **Contexto:** prompt mestre §7.13 (IA assistiva)

## Decisão

Toda capacidade de IA (minuta de ata, sugestão de ementa, resumo de tramitação, transcrição
de áudio, OCR de documento) é servida **exclusivamente no backend** via `z-ai-web-dev-sdk`
(`src/lib/server/ai.ts`), persiste um `AiArtifact` com input, output, modelo, provedor e
horário, e produz **sempre rascunho** (`status: draft`). Nenhuma saída de IA aprova,
publica, vota, altera resultado ou executa transição legislativa. A revisão é humana:
`POST /ai/artifacts/:id/review` com `approve|reject` (apenas papéis com `ai.review`),
auditada como `ai.artifact_reviewed`.

## Justificativa

O prompt mestre proíbe expressamente ação legislativa automática por IA e exige que toda
saída indique origem, modelo, versão, horário e responsável pela aprovação. O artefato
persistido com o contexto completo permite reprodutibilidade e auditoria posterior.

## Alternativas consideradas

1. **Aplicar sugestão de ementa com um clique** — rejeitada: acoplaria decisão editorial à
   máquina. A UI oferece "copiar" e deixa a aplicação manual para o administrador.
2. **Chamar o SDK no cliente** — rejeitada: exporia credenciais e burlaria a auditoria.

## Consequências

- Artefatos reprovados permanecem no histórico (rastreabilidade), mas jamais viram documento.
- Ata aprovada por IA ainda requer conferência humana — a homologação da Câmara é processo
  regimental externo ao sistema.
- Entitlement `ai_assist` (Fase 8) gateia as rotas por plano (402 `PLAN_LIMIT`).
- Erros do provedor → 502 `AI_PROVIDER_ERROR`; timeout 60s → 504 `AI_TIMEOUT`; entrada
  grande → 400 (base64 ≤ 8MB).
