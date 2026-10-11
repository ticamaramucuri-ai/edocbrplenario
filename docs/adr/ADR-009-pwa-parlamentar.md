# ADR-009 — App do Parlamentar (PWA) e endpoints `/me`

**Status:** Aceito · **Data:** Fase 7 · **Contexto:** prompt mestre §4.2/§7.5 (PWA de
parlamentares), adaptado ao sandbox (SPA de rota única).

## Decisão

O "App do Parlamentar" é um módulo mobile-first da SPA (`src/modules/pwa`) — layout
max-w-md centralizado no desktop, pleno em telas pequenas — apoiado por rotas dedicadas
`/api/v1/me/*` que agem **em nome do próprio parlamentar**: o `parliamentarianId` vem
SEMPRE do vínculo do ator autenticado (`User.parliamentarianId`), nunca do payload.

Regras de integridade idênticas às do operador (nada de atalhos):
- **voto**: mesma função de domínio da rota do operador — sessão open, votação open,
  parlamentar presente, idempotência por `commandId`, alteração conforme
  `allowVoteChange`; auditoria `vote.cast` com origem `pwa`;
- **presença**: auto check-in `source: 'pwa'` permitido apenas em
  check_in|open|suspended|resumed e se `TenantSettings.allowSelfCheckIn !== false`;
- **fila de oradores**: entrada direta quando a sessão está open.

## Justificativa

O parlamentar é o ator com maior risco de ações em nome de terceiros; amarrar a identidade
ao vínculo do ator elimina a superfície de ataque do `parliamentarianId` no payload. A
configuração `allowSelfCheckIn` respeita o princípio "não invente regras regimentais" —
cada Câmara decide seu modo de credenciamento.

## Alternativas consideradas

1. **Reutilizar rotas do operador com `parliamentarianId` no body** — rejeitada: exigiria
   confiar no cliente para identidade (impersonação trivial).
2. **PWA instalável com service worker no sandbox** — adiada: a restrição de rota única
   (`/`) impede manifest/escopo próprios; o layout mobile-first preserva a UX alvo. Em
   produção (rotas separadas) o mesmo módulo vira `/app` com manifest dedicado.

## Consequências

- `GET /me/context` é a fonte única de verdade do app (sessão, presença, votação aberta,
  voto próprio, posição na fila) — invalidação por eventos realtime.
- Votação secreta: o app registra participação; o valor jamais é ecoado para ninguém
  (`myVote.value: null`).
- Papéis sem vínculo parlamentar recebem 403 com mensagem clara; o módulo exibe EmptyState
  instrutivo.
